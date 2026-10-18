import * as THREE from 'three/webgpu'
import {
  BOARD,
  BOARD_DRIVERS,
  BoardDriver,
  CARTRIDGES,
  CARTRIDGE_KEYS,
  Cartridge,
  FIRMWARES,
  FIRMWARE_KEYS,
  FW,
  FW_TASKS,
  Firmware,
  PROBES,
  PROBE_FAULTS,
  HotendProbe,
  ProbeFault,
  boardView,
  cartridgeView,
  firmwareView,
  fwTopMmS,
  probeDegPerCount,
  probeReading,
} from '../../core/physics'
import { celsiusText, countText, fixedText, niceCeil, nmText, pct } from '../../core/units'
import { V3, add, box, cylinder, mat, rod } from '../../models/kit'
import {
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  cableRun,
  codeListing,
  cursorBar,
  flatBox,
  gcodeTint,
  glowMat,
  hostSbc,
  liveLabel,
  memoBy,
  moduleBlock,
  nema17,
  path,
  printPlotStage,
  printerMainboard,
  setGlow,
  tempColor,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const B_LIGHT = '#8ab8ff'
const amps = (a: number) => `${fixedText(a, 1)} A`
const watts = (w: number) => `${fixedText(w, w < 1 ? 2 : 1)} W`

// --- Mainboard and drivers ---

const DRIVER_NAMES = Object.fromEntries(Object.entries(BOARD_DRIVERS).map(([k, v]) => [k, v.name])) as Record<BoardDriver, string>
const SUPPLY_NAMES = { '24': '24 V supply', '12': '12 V supply' }
const mbParams = (p: Params) => ({ d: pick(DRIVER_NAMES, p.drv, 'tmc2209') as BoardDriver, a: n(p, 'amps'), v: Number(pick(SUPPLY_NAMES, p.psu, '24')), s: n(p, 'mms') })
const mbKey = (p: Params) => `${p.drv} ${p.amps} ${p.psu} ${p.mms}`
const mbRun = memoBy(mbKey, (p: Params) => {
  const q = mbParams(p)
  return { q, V: boardView(q.d, q.a, q.v, q.s) }
})
const SLOW = 20

export const printerElectronicsMainboardAndDrivers: Lesson = {
  id: 'printer-electronics-mainboard-and-drivers',
  title: 'Mainboard and drivers',
  tagline: 'From a G-code line to coil current',
  formula: (p) => {
    const { q, V } = mbRun(p)
    const d = BOARD_DRIVERS[q.d]
    return `steps/s = ${q.s} mm/s × ${V.spm} steps/mm = ${countText(V.stepHz)} · driver loss 2 I² Rds = 2 × ${fixedText(q.a, 1)}² × ${d.rdsOhm} Ω = ${watts(V.driverW)} → ${celsiusText(V.driverC)} · coils 2 I² R = ${watts(2 * q.a ** 2 * 1.5)} · bed I = P / V = ${BOARD.bedW} / ${q.v} = ${amps(V.bedA)}, MOSFET I² R = ${watts(V.bedFetW)}, typical`
  },
  legend: [
    { color: POWER, label: 'Pull-out torque vs speed on your supply', shape: 'dot' },
    { color: GREY, label: 'Same current on the other supply', shape: 'dot' },
    { color: HIGH_V, label: 'Torque the Y axis needs', shape: 'dot' },
    { color: RING, label: 'Signal path to the Y motor', shape: 'dot' },
  ],
  points: [
    'The mainboard is a microcontroller plus power stages. The MCU reads G-code from USB or the SD card, plans each move and toggles a STEP pin once per microstep and a DIR pin for direction (G-code > G0, G1 moves). It never drives a motor itself.',
    'Each axis has a stepper driver in a socket: an H-bridge per coil that chops the motor supply to hold a set current and steps through the sine table on every STEP pulse (Stepper > A4988 and TMC drivers). An A4988 sets that current with a Vref trimmer; a TMC2209 takes it over UART from the firmware.',
    'Current is torque and heat. Torque scales with current, but coil heat goes as I² R and the driver chip warms as I² Rds(on): an A4988 cooks itself above about 1 A and shuts down, so the motor stops and the axis loses steps. Set the lowest current that still has margin at your top speed.',
    'The same board switches the heaters with MOSFETs on the bed and hotend outputs. A heater of the same power draws half the current on 24 V, so the MOSFET, wires and connectors run four times cooler (Wiring & gauge > Connector ratings; MOSFET > Low-side switching), and the motors keep torque at speed because more voltage beats the coil back-EMF.',
  ],
  controls: [
    { kind: 'choice', key: 'drv', options: opts(DRIVER_NAMES), initial: 'tmc2209' },
    { kind: 'slider', key: 'amps', label: 'Driver run current (RMS)', min: 0.2, max: 2, step: 0.1, initial: 0.8, format: (v) => amps(v) },
    { kind: 'choice', key: 'psu', options: opts(SUPPLY_NAMES), initial: '24' },
    { kind: 'slider', key: 'mms', label: 'Y axis speed', min: 20, max: BOARD.maxMmS, step: 20, initial: 200, format: (v) => `${v} mm/s` },
  ],
  build(): Stage {
    const c = printPlotStage('pull-out torque vs speed', '0 mm/s', `${BOARD.maxMmS} mm/s`, { title: 'Heat, W (typical)', names: ['Motor coils', 'Driver chip', 'Bed MOSFET', 'Hotend MOSFET'] })
    const { scene, head, rows, plot, tally, yTop } = c
    const k = 0.145
    const mb = printerMainboard(scene, [-8.6, -1.9, 0], k)
    const motor = nema17(scene, [-14.4, -10.5, 0], 1.15)
    const m0 = mb.spot('motor1')
    const mp = motor.pins
    cableRun(scene, [m0, [m0[0], m0[1] + 0.6, m0[2]], [-17.1, m0[1] + 0.6, m0[2]], [-17.1, mp[0][1] - 0.4, mp[0][2]], [mp[1][0], mp[0][1] - 0.4, mp[0][2]], mp[1]], '#3a3e47', 0.1)
    const code = codeListing(scene, [-11.4, -9.2, 0.3], 3, 10, 0.3, 0.62)
    const S = plot.s
    const tr = { other: S.trace(GREY, { samples: 51, radius: 0.04 }), mine: S.trace(POWER, { samples: 51, radius: 0.07 }) }
    const need = S.level(HIGH_V)
    const cur = cursorBar(S, RING, 0.06)
    let t = 0
    let rotor = 0
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = mbRun(p)
        t += dt
        const off = V.state === 'off'
        mb.setKind(q.d)
        const top = niceCeil(Math.max(0.2, V.holdNm, ...V.curves.flat()))
        const py = c.py(0, top)
        const us = V.curves[0].map((_, i) => i / (V.curves[0].length - 1))
        const mine = q.v === 24 ? 1 : 0
        tr.mine.points(us, V.curves[mine].map(py), null)
        tr.other.points(us, V.curves[1 - mine].map(py), null)
        need.set(py(BOARD.needNm))
        cur(q.s / BOARD.maxMmS)
        yTop.set(nmText(top))
        plot.right.set(off ? 'driver off: 0 N·m' : `${nmText(V.pullNm)} at ${q.s} mm/s`, V.skips ? HIGH_V : POWER)

        const pulse = 0.5 + 0.5 * Math.sin(t * 14)
        const phase = (t % 3) / 3
        mb.glow('usb', RING, phase < 0.3 ? 1 : 0.1)
        mb.glow('mcu', RING, 0.25 + 0.5 * pulse)
        for (let i = 0; i < 4; i++) {
          mb.glow(`step${i}`, RING, i === 1 && !off ? 0.3 + 0.7 * pulse : 0)
          mb.glow(`coil${i}`, B_LIGHT, i === 1 && !off ? 0.8 : 0)
          const d = BOARD_DRIVERS[q.d]
          const heat = i === 1 ? Math.min(1, (V.driverC - 25) / (d.offC - 25)) : 0
          mb.drivers[i].chip(off && i === 1 ? HIGH_V : HEAT, i === 1 ? (off ? 0.6 + 0.4 * pulse : heat * 0.8) : 0)
        }
        mb.glow('power', HEAT, 0.6)
        mb.glow('bed', RING, 0.3)
        mb.glow('he0', RING, 0.3)
        mb.glow('qbed', HEAT, Math.min(1, V.bedFetW / 3))
        mb.glow('qhe', HEAT, Math.min(1, V.hotFetW / 3))

        const w = off ? 0 : (V.rpm / 60) * 2 * Math.PI / SLOW
        const slip = V.skips && !off
        rotor += slip ? w * dt * 0.3 * Math.sign(Math.sin(t * 7)) : w * dt
        const elec = rotor * 50
        const lv = off ? 0 : Math.min(1, q.a / 1.5)
        motor.set(rotor, lv * Math.cos(slip ? elec * 3 : elec), lv * Math.sin(slip ? elec * 3 : elec))

        code.set(['G1 Y180 F' + q.s * 60, `→ ${countText(V.stepHz)} STEP pulses/s`, off ? '→ driver in thermal shutdown' : V.skips ? '→ rotor slips: lost steps' : '→ coils follow, 1/16 step'], phase < 0.3 ? 0 : phase < 0.65 ? 1 : 2, (l, i) => (i === 0 ? gcodeTint(l) : off || (i === 2 && V.skips) ? HIGH_V : LABEL))

        const d = BOARD_DRIVERS[q.d]
        rows[0].set(`Y driver ${d.name} ${amps(q.a)}${V.vref !== null ? ` (Vref ${fixedText(V.vref, 2)} V)` : ' (UART)'}: ${watts(V.driverW)} → ${celsiusText(V.driverC)}`, off ? HIGH_V : V.state === 'hot' ? HEAT : POWER)
        rows[1].set(off ? 'Motor: no current, the axis stops, position lost' : `Motor: ${watts(V.motorW)} → ${celsiusText(V.motorC)}; ${nmText(V.pullNm)} of ${nmText(BOARD.needNm)} needed`, off || V.skips ? HIGH_V : V.motorC > 80 ? HEAT : POWER)
        rows[2].set(`${q.v} V: ${BOARD.bedW} W bed draws ${amps(V.bedA)} (MOSFET ${watts(V.bedFetW)}), PSU ${amps(V.psuA)}`, V.bedA > 12 ? HEAT : LABEL)
        tally?.set([V.motorW, V.driverW, V.bedFetW, V.hotFetW], [V.motorW, V.driverW, V.bedFetW, V.hotFetW].map(watts), [V.motorC > 80 ? HEAT : POWER, off ? HIGH_V : V.state === 'hot' ? HEAT : POWER, V.bedFetW > 2 ? HEAT : POWER, POWER], Math.max(4, V.motorW, V.driverW))
        head.status.set(`Mainboard and drivers · ${d.name} at ${amps(q.a)}, ${q.v} V`)
        head.sub.set(`Y at ${q.s} mm/s = ${countText(V.stepHz)} steps/s, ${Math.round(V.rpm)} rpm (motor shown ${SLOW}× slow) · top speed ${V.topMmS} mm/s`, GREY)
        head.event.set(off ? `${d.name} over ${d.offC} °C: thermal shutdown` : V.skips ? `pull-out ${nmText(V.pullNm)} < ${nmText(BOARD.needNm)}: skipped steps, layer shift` : ['USB: a G-code line reaches the MCU', 'MCU: plans the move, times STEP pulses', 'driver: steps the coil currents'][phase < 0.3 ? 0 : phase < 0.65 ? 1 : 2], off || V.skips ? HIGH_V : RING)
      },
      readouts: (p) => {
        const { V } = mbRun(p)
        return [
          { label: 'Steps/s', value: countText(V.stepHz) },
          { label: 'Driver', value: celsiusText(V.driverC), tone: toneOf(V.state === 'ok', V.state === 'hot') },
          { label: 'Torque', value: `${fixedText(V.pullNm / BOARD.needNm, 1)}× need`, tone: toneOf(V.pullNm > 2 * BOARD.needNm, !V.skips) },
          { label: 'PSU', value: amps(V.psuA) },
        ]
      },
    }
  },
}

// --- Marlin and Klipper ---

const FW_NAMES = Object.fromEntries(FIRMWARE_KEYS.map((k) => [k, FIRMWARES[k].name])) as Record<Firmware, string>
const FW_COLORS: Record<Firmware, string> = { marlin8: HEAT, marlin32: RING, klipper8: B_LIGHT, klipper32: POWER }
const FW_SHORT = ['Marlin 8-bit', 'Marlin 32-bit', 'Klipper 8-bit', 'Klipper 32-bit']
const MICRO_NAMES = { '16': '1/16 microsteps', '32': '1/32 microsteps', '64': '1/64 microsteps' }
const fwParams = (p: Params) => ({ fw: pick(FW_NAMES, p.fw, 'marlin8') as Firmware, s: n(p, 'mms'), micro: Number(pick(MICRO_NAMES, p.micro, '16')) })
const fwKey = (p: Params) => `${p.fw} ${p.mms} ${p.micro}`
const fwRun = memoBy(fwKey, (p: Params) => {
  const q = fwParams(p)
  return { q, V: firmwareView(q.fw, q.s, q.micro), tops: FIRMWARE_KEYS.map((k) => fwTopMmS(k, q.micro)) }
})
const FW_TOP = 2
const PI_COLOR = B_LIGHT
const mmS = (v: number) => `${countText(v)} mm/s`

export const printerElectronicsMarlinAndKlipper: Lesson = {
  id: 'printer-electronics-marlin-and-klipper',
  title: 'Marlin and Klipper',
  tagline: 'Where the firmware does its work',
  formula: (p) => {
    const { q, V } = fwRun(p)
    return `steps/s = ${q.s} mm/s × ${fixedText(V.stepHz / q.s, 0)} steps per mm of curve (X + Y at 1/${q.micro} + E) = ${countText(V.stepHz)} · lines/s = ${q.s} / ${FW.segMm} mm = ${Math.round(V.linesS)} · MCU load = Σ cycles / ${FIRMWARES[q.fw].mhz} MHz = ${pct(V.load)} → top ${mmS(V.top)}, typical`
  },
  legend: [
    ...FIRMWARE_KEYS.map((k, i) => ({ color: FW_COLORS[k], label: `${FW_SHORT[i]}: MCU load vs speed`, shape: 'dot' as const })),
    { color: HIGH_V, label: '100 %: the MCU can not keep up', shape: 'dot' },
  ],
  points: [
    'Firmware turns G-code into step pulses. Every line has to be read, fitted into the planner (acceleration and junction speeds over the next few moves), run through the kinematics (CoreXY or delta maths, Printer motion > Axes and endstops) and finally timed out as STEP pulses, each to the microsecond (Timers & interrupts > Hardware timers).',
    'Marlin does all of it on the printer\'s own MCU. On an old 16 MHz 8-bit board that budget runs out: fast curves cut into short segments arrive faster than the planner can digest them, and 1/32 or 1/64 microstepping multiplies the step rate. The printer stutters, slows down and leaves blobs.',
    'Klipper splits the job. A host computer, usually a Raspberry Pi, reads the G-code, plans and does the kinematics, then sends the MCU a compressed schedule: step at these times. The MCU only times pulses, so the same cheap board runs several times faster, and input shaping (Printer motion > Input shaping) and pressure advance (Calibration > Pressure advance) cost the MCU nothing.',
    'Settings live in different places. Marlin is configured in Configuration.h and has to be recompiled and flashed for most changes; Klipper reads printer.cfg at start-up, so a new rotation distance or a new board pin is an edit and a RESTART. Marlin needs no Pi and boots instantly; Klipper needs the host running.',
  ],
  controls: [
    { kind: 'choice', key: 'fw', options: opts(FW_NAMES), initial: 'marlin8' },
    { kind: 'slider', key: 'mms', label: 'Print speed on curves', min: 20, max: FW.maxMmS, step: 20, initial: 160, format: (v) => `${v} mm/s` },
    { kind: 'choice', key: 'micro', options: opts(MICRO_NAMES), initial: '16' },
  ],
  build(): Stage {
    const c = printPlotStage('MCU load vs speed', '0 mm/s', `${FW.maxMmS} mm/s`, { title: 'Top speed the MCU keeps up with', names: FW_SHORT })
    const { scene, head, rows, plot, tally, yTop } = c
    const pi = hostSbc(scene, [-12.8, 1.4, 0], 0.085)
    const mb = printerMainboard(scene, [-10.7, -6.6, 0], 0.1)
    const u0 = pi.usb
    const u1 = mb.spot('usb')
    const cable: V3[] = [u0, [u0[0] + 0.5, u0[1], u0[2]], [u0[0] + 0.5, -1.9, u0[2]], [u1[0] - 0.6, -1.9, u0[2]], [u1[0] - 0.6, u1[1], u1[2]], u1]
    cableRun(scene, cable, '#3a3e47', 0.1)
    const curve = path(cable)
    const packets = Array.from({ length: 5 }, () => add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), glowMat(RING, 1))))
    const blocks = FW_TASKS.map((name, i) => moduleBlock(scene, [-2.6, 3.1 - i * 1.7, 0], [4.6, 1.0, 0.4], name))
    const where = FW_TASKS.map((_, i) => liveLabel(scene, [-2.6, 3.1 - i * 1.7 - 0.8, 0.3], { size: 0.27, align: 'center' }))
    const code = codeListing(scene, [-4.9, -4.6, 0.3], 5, 7.2, 0.27, 0.56)
    const S = plot.s
    const tr = FIRMWARE_KEYS.map((k) => S.trace(FW_COLORS[k], { samples: 51, radius: 0.05 }))
    const full = S.level(HIGH_V)
    const cur = cursorBar(S, LABEL, 0.06)
    let t = 0
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V, tops } = fwRun(p)
        const f = FIRMWARES[q.fw]
        t += dt
        const py = c.py(0, FW_TOP)
        V.curves.forEach((cv, i) => tr[i].points(V.speeds.map((s) => s / FW.maxMmS), cv.map((l) => py(Math.min(FW_TOP, l))), FIRMWARE_KEYS[i] === q.fw ? Math.round((q.s / FW.maxMmS) * 50) : null))
        full.set(py(1))
        cur(q.s / FW.maxMmS)
        yTop.set(pct(FW_TOP))
        plot.right.set(`${FW_SHORT[FIRMWARE_KEYS.indexOf(q.fw)]}: ${pct(V.load)}`, V.keeps ? FW_COLORS[q.fw] : HIGH_V)
        tally?.set(tops.map((v) => Math.min(v, 2000)), tops.map((v) => (v > 2000 ? '2k+ mm/s' : mmS(v))), FIRMWARE_KEYS.map((k) => (k === q.fw ? FW_COLORS[k] : GREY)), 2000)

        const busy = Math.min(1, V.load)
        const pulse = 0.5 + 0.5 * Math.sin(t * (6 + 20 * busy))
        mb.glow('mcu', V.keeps ? RING : HIGH_V, 0.2 + 0.7 * busy * (V.keeps ? 1 : pulse))
        pi.glow(PI_COLOR, f.host ? 0.25 + 0.4 * pulse * Math.min(1, V.hostPct * 20) : 0)
        mb.glow('usb', f.host ? PI_COLOR : RING, 0.5)
        for (let i = 0; i < 4; i++) {
          mb.glow(`step${i}`, RING, i < 2 || i === 3 ? 0.3 + 0.6 * pulse : 0)
          mb.drivers[i].chip(RING, 0)
        }
        const rate = 0.15 + 0.35 * Math.min(1, V.linesS / 600)
        packets.forEach((m, i) => {
          const u = (t * rate + i / packets.length) % 1
          m.position.copy(curve.getPointAt(u))
          ;(m.material as THREE.MeshStandardMaterial).emissive.set(f.host ? PI_COLOR : RING)
        })
        FW_TASKS.forEach((_, i) => {
          const onPi = f.host && i < 3
          blocks[i](dt, onPi ? PI_COLOR : V.keeps ? RING : HIGH_V, onPi ? 0.8 : Math.min(1, 0.3 + 2 * V.tasks[i]))
          where[i].set(onPi ? 'on the Pi' : `on the MCU: ${pct(V.tasks[i])}`, onPi ? PI_COLOR : V.keeps ? LABEL : HIGH_V)
        })
        code.set(V.config, -1, (l) => (l.startsWith('//') || l.startsWith('#') && !l.startsWith('#define') ? GREY : f.host ? PI_COLOR : RING))

        rows[0].set(`${f.name}: MCU ${pct(V.load)} busy at ${q.s} mm/s`, V.keeps ? LABEL : HIGH_V)
        rows[1].set(V.keeps ? `Keeps up; tops out near ${mmS(V.top)} at 1/${q.micro} steps` : `Falls behind: stutters at about ${mmS(V.top)}, blobs on curves`, V.keeps ? POWER : HIGH_V)
        rows[2].set(`New steps/mm: ${f.change}`, f.host ? POWER : HEAT)
        head.status.set(`Marlin and Klipper · ${f.name}`)
        head.sub.set(`${Math.round(V.linesS)} lines/s, ${countText(V.stepHz)} steps/s at 1/${q.micro} · ${f.mhz} MHz MCU · ${f.host ? `Pi ${fixedText(V.hostPct * 100, 1)} % of a core` : 'no host'}`, GREY)
        head.event.set(f.extras, f.host ? POWER : q.fw === 'marlin8' ? HEAT : LABEL)
      },
      readouts: (p) => {
        const { V } = fwRun(p)
        return [
          { label: 'MCU load', value: pct(V.load), tone: toneOf(V.load < 0.7, V.load <= 1) },
          { label: 'Steps/s', value: countText(V.stepHz) },
          { label: 'Top speed', value: mmS(V.top) },
          { label: 'Prints at', value: mmS(V.actualMmS), tone: toneOf(V.keeps, false) },
        ]
      },
    }
  },
}

// --- Thermistors and heaters ---

const PROBE_NAMES = Object.fromEntries(Object.entries(PROBES).map(([k, v]) => [k, v.name])) as Record<HotendProbe, string>
const CART_NAMES = Object.fromEntries(CARTRIDGE_KEYS.map((k) => [k, CARTRIDGES[k].name])) as Record<Cartridge, string>
const FAULT_NAMES = PROBE_FAULTS as Record<ProbeFault, string>
const thParams = (p: Params) => ({ c: n(p, 'c'), probe: pick(PROBE_NAMES, p.probe, 'ntc') as HotendProbe, cart: pick(CART_NAMES, p.cart, 'r24w40') as Cartridge, fault: pick(FAULT_NAMES, p.fault, 'none') as ProbeFault })
const thKey = (p: Params) => `${p.c} ${p.probe} ${p.cart} ${p.fault}`
const T_MAX = 400
const PER_TOP = 2.5
const TEMPS = Array.from({ length: 81 }, (_, i) => (i * T_MAX) / 80)
const thRun = memoBy(thKey, (p: Params) => {
  const q = thParams(p)
  return { q, R: probeReading(q.probe, q.c, q.fault), H: cartridgeView(q.cart, q.c), curves: (['ntc', 'pt1000'] as const).map((k) => TEMPS.map((c) => probeDegPerCount(k, Math.max(1, c)))) }
})
const ohmText = (r: number) => (r === Infinity ? 'open' : r >= 1000 ? `${fixedText(r / 1000, r >= 10e3 ? 0 : 1)} kΩ` : `${fixedText(r, 0)} Ω`)
const readText = (c: number) => (c >= 9999 ? 'off scale hot' : c < -200 ? 'off scale cold' : celsiusText(c))
const PROBE_COLOR = { ntc: B_LIGHT, pt1000: POWER }

export const printerElectronicsThermistorsAndHeaters: Lesson = {
  id: 'printer-electronics-thermistors-and-heaters',
  title: 'Thermistors and heaters',
  tagline: 'Reading the hotend, powering it',
  formula: (p) => {
    const { q, R, H } = thRun(p)
    const law = q.probe === 'ntc' ? `R = 100k e^(3950 (1/T − 1/298 K))` : `R = 1000 (1 + 0.0039 T)`
    return `${law} = ${ohmText(R.ohms)} · V = 3.3 R / (R + 4.7k) = ${fixedText(R.volts, 3)} V → count ${R.raw} of 4096 · heater P = V² / R = ${CARTRIDGES[q.cart].supplyV}² / ${fixedText(H.ohms, 1)} Ω = ${watts(H.watts)}, hold ${celsiusText(q.c)} at ${pct(H.duty)} PWM`
  },
  legend: [
    { color: B_LIGHT, label: 'NTC 100k: °C per ADC count vs temperature', shape: 'dot' },
    { color: POWER, label: 'PT1000: °C per ADC count', shape: 'dot' },
    { color: RING, label: 'Your block temperature', shape: 'dot' },
    { color: HIGH_V, label: '1 °C per count', shape: 'dot' },
  ],
  points: [
    'The hotend thermistor is a 100 kΩ NTC bead: its resistance falls about 10× every 50 °C (Temperature & humidity > Thermistor curve). The board puts it under a 4.7 kΩ pull-up and reads the middle with its ADC (ADC > Resolution and range); firmware turns the count back into °C with the Beta equation or a table.',
    'Hot, the NTC is down to a few hundred ohms and the divider voltage hugs zero, so one ADC count spans more and more degrees: about 0.1 °C at 200 °C but over 1 °C at 350 °C, and the glass bead itself is only rated to about 300 °C. For nylon and polycarbonate at 300 °C and up, printers use a PT1000 (or a PT100 with an amplifier), whose resistance rises gently and evenly.',
    'The heater is a cartridge resistor: P = V² / R. A 24 V 40 W cartridge is 14.4 Ω; on 12 V it gives only 10 W and never gets hot, while a 12 V cartridge on 24 V gives 160 W, four times its rating. The MOSFET pulses it with PWM, and the PID loop sets the duty that holds the setpoint (Temperature & cooling > Hotend PID tuning).',
    'Firmware watches the reading. A broken thermistor wire reads far below room temperature and a shorted one impossibly hot, so MINTEMP / MAXTEMP shut the heaters off at once. A bead that falls out of the block still reads plausible, but too cold, so the heater runs flat out: only thermal runaway protection catches that (Temperature & cooling > Thermal runaway protection).',
  ],
  controls: [
    { kind: 'slider', key: 'c', label: 'Block temperature', min: 25, max: T_MAX, step: 5, initial: 220, format: (v) => celsiusText(v) },
    { kind: 'choice', key: 'probe', options: opts(PROBE_NAMES), initial: 'ntc' },
    { kind: 'choice', key: 'cart', options: opts(CART_NAMES), initial: 'r24w40' },
    { kind: 'choice', key: 'fault', options: opts(FAULT_NAMES), initial: 'none' },
  ],
  build(): Stage {
    const c = printPlotStage('°C per ADC count', '0 °C', `${T_MAX} °C`, { title: 'Heater power on full PWM', names: ['24 V 40 W', '24 V 60 W', '12 V 40 W', '24 V on 12 V', '12 V on 24 V'] })
    const { scene, head, rows, plot, tally, yTop } = c
    const blockMat = new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.4, roughness: 0.4, emissive: '#000000' })
    const B: V3 = [-12, -2.6, 0]
    box(scene, [6, 4.2, 2.6], blockMat, B)
    const cartMat = glowMat(HEAT, 0)
    cylinder(scene, 0.62, 6.2, cartMat, [B[0] - 1.5, B[1] + 0.8, 0.6], 'x', 20)
    const beadMat = glowMat(B_LIGHT, 0.6)
    const bead = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), beadMat), [B[0] + 1.6, B[1] - 0.8, 1.4])
    cylinder(scene, 0.5, 1.8, mat('#d9d4c8', { rough: 0.5 }), [B[0], B[1] - 3, 0], 'y', 16)
    addLabel(scene, 'heater block', [B[0], B[1] + 2.7, 0.3], GREY, 0.3)
    addLabel(scene, 'cartridge', [B[0] - 4.6, B[1] + 1.8, 0.3], HEAT, 0.3)
    const blockTag = liveLabel(scene, [B[0], B[1] - 4.5, 0.3], { size: 0.32 })
    const X = -3.4
    const CY = (i: number) => 3.3 - i * 2.05
    const chain = ['3.3 V', '4.7 kΩ pull-up', 'ADC pin', 'probe', 'GND'].map((s, i) => moduleBlock(scene, [X, CY(i), 0], [4.8, 1.0, 0.4], s))
    const chainTag = [1, 2, 3].map((i) => liveLabel(scene, [X, CY(i) - 0.72, 0.3], { size: 0.27 }))
    for (let i = 0; i < 4; i++) rod(scene, [X - 2.7, CY(i) - 0.5, 0], [X - 2.7, CY(i + 1) + 0.5, 0], 0.07, mat('#c9ced8'))
    const pb = bead.position
    cableRun(scene, [[pb.x, pb.y, pb.z], [pb.x + 2.2, pb.y, pb.z], [pb.x + 1.6, CY(3), pb.z], [X - 2.4, CY(3), 0.2]], '#e8e2d6', 0.07)
    const pwm = Array.from({ length: 12 }, (_, i) => flatBox(scene, [0.34, 1, 0.05], glowMat(HEAT, 0.9), [-16.4 + i * 0.68, -9.6, 0.2]))
    addLabel(scene, 'MOSFET PWM to the cartridge', [-16.8, -8.4, 0.3], GREY, 0.28, 'left')
    const pwmTag = liveLabel(scene, [-16.8, -11.0, 0.3], { size: 0.3, align: 'left' })
    const S = plot.s
    const tr = { ntc: S.trace(B_LIGHT, { samples: 81, radius: 0.06 }), pt1000: S.trace(POWER, { samples: 81, radius: 0.06 }) }
    const cur = cursorBar(S, RING, 0.06)
    const glass = S.level(HIGH_V)
    const col = new THREE.Color()
    let t = 0
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, R, H, curves } = thRun(p)
        t += dt
        const py = c.py(0, PER_TOP)
        const us = TEMPS.map((x) => x / T_MAX)
        const ix = Math.round((q.c / T_MAX) * 80)
        tr.ntc.points(us, curves[0].map((v) => py(Math.min(PER_TOP, v))), q.probe === 'ntc' ? ix : null)
        tr.pt1000.points(us, curves[1].map((v) => py(Math.min(PER_TOP, v))), q.probe === 'pt1000' ? ix : null)
        cur(q.c / T_MAX)
        glass.set(py(1))
        yTop.set(`${PER_TOP} °C`)
        plot.right.set(`${q.probe === 'ntc' ? 'NTC' : 'PT1000'} at ${celsiusText(q.c)}: ${fixedText(R.perCount, 2)} °C`, PROBE_COLOR[q.probe])
        const powers = CARTRIDGE_KEYS.map((k) => cartridgeView(k, q.c).watts)
        tally?.set(powers, powers.map((w) => watts(w)), CARTRIDGE_KEYS.map((k, i) => (k === q.cart ? (powers[i] > 100 || powers[i] < 20 ? HIGH_V : RING) : GREY)), 160)

        const halted = R.error === 'MAXTEMP' || R.error === 'MINTEMP'
        const shownC = q.fault === 'loose' ? Math.min(q.c + 60, 450) : q.c
        tempColor(shownC, col)
        blockMat.emissive.copy(col)
        blockMat.emissiveIntensity = Math.min(0.8, (shownC - 25) / 300)
        const duty = halted ? 0 : q.fault === 'loose' ? 1 : H.duty
        setGlow(cartMat, HEAT, 0.15 + 0.9 * duty)
        bead.visible = true
        bead.position.set(B[0] + (q.fault === 'loose' ? 4.0 : 1.6), B[1] - 0.8, 1.4)
        setGlow(beadMat, PROBE_COLOR[q.probe], 0.6)
        blockTag.set(`block ${celsiusText(q.c)}${q.fault === 'loose' ? ', still climbing' : ''}`, LABEL)
        const on = (t * 2) % 1
        pwm.forEach((b, i) => (b.visible = (i / pwm.length + on / pwm.length) % (1 / 3) < duty / 3 || duty >= 1))
        pwmTag.set(halted ? 'heater cut off' : `${pct(duty)} duty of ${watts(H.watts)} = ${watts(duty * H.watts)}`, halted ? HIGH_V : H.over ? HIGH_V : HEAT)

        const bad = R.error !== null
        chain.forEach((blk, i) => blk(dt, i === 2 ? (bad ? HIGH_V : RING) : i === 3 ? PROBE_COLOR[q.probe] : GREY, i === 0 || i === 4 ? 0.3 : 0.8))
        chainTag[0].set(`${fixedText(R.volts, 3)} V in the middle`, LABEL)
        chainTag[1].set(`count ${R.raw} of 4096 → reads ${readText(R.readC)}`, bad ? HIGH_V : RING)
        chainTag[2].set(`${ohmText(R.ohms)}${q.fault === 'short' ? ' (shorted)' : ''}`, PROBE_COLOR[q.probe])

        rows[0].set(`${PROBES[q.probe].name} at ${celsiusText(R.seenC)}: ${ohmText(R.ohms)} → ${fixedText(R.volts, 3)} V → reads ${readText(R.readC)}`, bad ? HIGH_V : LABEL)
        rows[1].set(
          R.error === 'MINTEMP' ? 'MINTEMP: reads impossibly cold, heaters off' : R.error === 'MAXTEMP' ? (q.fault === 'none' ? `MAXTEMP ${PROBES[q.probe].maxC} °C: heaters off (use a PT1000 here)` : 'MAXTEMP: reads impossibly hot, heaters off') : R.error === 'runaway' ? 'reads cold, heater flat out: thermal runaway trips' : `1 count = ${fixedText(R.perCount, 2)} °C here; a 10-bit board is 4× coarser`,
          bad ? HIGH_V : R.perCount > 1 ? HEAT : POWER,
        )
        rows[2].set(`${CARTRIDGES[q.cart].name}: ${fixedText(H.ohms, 1)} Ω, ${watts(H.watts)}, ${amps(H.amps)}${H.over ? ', 4× its rating' : !H.reaches ? `, tops out at ${celsiusText(H.ceilingC)}` : ''}`, H.over || !H.reaches ? HIGH_V : POWER)
        head.status.set(`Thermistors and heaters · ${PROBES[q.probe].name}, ${CARTRIDGES[q.cart].name}`)
        head.sub.set(H.reaches ? `heats 25 → ${celsiusText(q.c)} in about ${Math.round(H.heatS)} s at full power, typical` : `can not reach ${celsiusText(q.c)}: ${watts(H.watts)} only holds ${celsiusText(H.ceilingC)}`, GREY)
        head.event.set(PROBE_FAULTS[q.fault] + (halted ? ` → ${R.error}, heaters cut` : q.fault === 'loose' ? ' → reads low, heater runs away' : ''), q.fault === 'none' ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const { R, H } = thRun(p)
        return [
          { label: 'Reads', value: readText(R.readC), tone: toneOf(R.error === null, false) },
          { label: '°C/count', value: fixedText(R.perCount, 2), tone: toneOf(R.perCount < 0.5, R.perCount < 1.5) },
          { label: 'Heater', value: watts(H.watts), tone: toneOf(!H.over && H.reaches, false) },
          { label: 'PWM', value: pct(R.error === 'MAXTEMP' || R.error === 'MINTEMP' ? 0 : R.error === 'runaway' ? 1 : H.duty), tone: toneOf(R.error === null, false) },
        ]
      },
    }
  },
}
