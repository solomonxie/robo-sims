import * as THREE from 'three/webgpu'
import {
  AIR_KG_M3,
  CENTRIFUGAL_12V,
  DC_SPEED_FRACTION,
  PERI_PUMP,
  WATER_KG_M3,
  centrifugalHeadM,
  centrifugalLpm,
  clamp01,
  doseRevs,
  doseSeconds,
  doseSteps,
  dosedMl,
  periDeliveredMl,
  periFlowMlMin,
  periMlPerRev,
  periPrimeMl,
  periPulse,
  periPulseErrorMl,
  tipSpeed,
  wrap2pi,
  wrapPi,
  SOLENOID_12V as SOL,
  SOLENOID_RUN,
  SolenoidDrive,
  SolenoidOpts,
  coilLimitS,
  coilSteadyC,
  coilWatts,
  fixedStepAt,
  maxDutyCycle,
  pwmHoldAmps,
  solenoidDropOutAmps,
  solenoidForceN,
  solenoidGapB,
  solenoidPullInAmps,
  solenoidRun,
  solenoidSummary,
} from '../../core/physics'
import { msText, secs } from '../../core/units'
import { V3, add, box, cylinder, mat, rod, STEEL } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CONVENTIONAL,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  PIN_COLOR,
  POWER,
  RING,
  addLabel,
  arrow,
  cell,
  codeBlock,
  coil,
  cursorBar,
  diodeAlong,
  fetPart,
  frac,
  glowMat,
  heatGlow,
  heatWaves,
  litWire,
  liveLabel,
  memoBy,
  motorCan,
  nema17,
  path,
  plusFlow,
  scope,
  shellMat,
  simClock,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const pct = (f: number) => `${Math.round(f * 100)} %`
const amps = (a: number) => `${a.toFixed(2)} A`
const watts = (w: number) => `${w < 10 ? w.toFixed(1) : w.toFixed(0)} W`

// --- Solenoid drive: force ∝ 1/gap², low-side FET + flyback diode, peak-and-hold PWM, duty-cycle heat. ---

const DRIVES = { peakhold: 'Peak and hold', full: 'Full 12 V', pwm: 'PWM only' }
const DIODE = { yes: 'Flyback diode', no: 'No diode' }
const FULL_A = SOL.volts / SOL.ohms
const SD = { cx: -8, cy: 5, len: 5, r: 1.5, show: 2.4, plungerL: 5.4, slow: 50, lead: 2, yDi: 2.1, y12: 0.4, yG: -7.6, cellX: -14, sx: 6.6, sw: 11, S: 600 }
const POLE = SD.cx - SD.len / 2 + 1
const solParams = (p: Params): SolenoidOpts & { drive: SolenoidDrive } => ({
  drive: pick(DRIVES, p.drive, 'peakhold') as SolenoidDrive,
  holdDuty: n(p, 'hold') / 100,
  loadN: n(p, 'load'),
  diode: pick(DIODE, p.diode, 'yes') === 'yes',
})
const solKey = (o: SolenoidOpts) => `${o.drive}|${o.holdDuty}|${o.loadN}|${o.diode}`
const solMemo = memoBy(solKey, (o: SolenoidOpts) => {
  const run = solenoidRun(o)
  return { run, sum: solenoidSummary(run, o) }
})
const heldAmps = (o: SolenoidOpts) => (o.drive === 'full' ? FULL_A : pwmHoldAmps(o.holdDuty))
const heldWatts = (o: SolenoidOpts) => coilWatts(heldAmps(o))

function solCode(o: SolenoidOpts) {
  const counts = Math.round(o.holdDuty * 255)
  const hold = `ledcWrite(SOL, ${counts});  // hold ${pct(o.holdDuty)}: ${amps(pwmHoldAmps(o.holdDuty))}, ${watts(heldWatts(o))}`
  if (o.drive === 'full') return ['digitalWrite(SOL, HIGH);  // 2 A, 24 W while on', `// from cold: ${secs(coilLimitS(coilWatts(FULL_A)))} to ${SOL.maxC} °C, ED ≤ ${pct(maxDutyCycle(coilWatts(FULL_A)))}`, 'delay(85);', 'digitalWrite(SOL, LOW);']
  if (o.drive === 'pwm') return ['ledcAttach(SOL, 20000, 8);  // 20 kHz, inaudible', hold, `// pull-in needs ${amps(solenoidPullInAmps(o.loadN))}: it never moves`, 'ledcWrite(SOL, 0);']
  return ['ledcAttach(SOL, 20000, 8);  // 20 kHz, inaudible', `ledcWrite(SOL, 255);  delay(${SOLENOID_RUN.peakS * 1000});  // peak: ${amps(FULL_A)} pulls in`, hold, 'ledcWrite(SOL, 0);  // release']
}

export const solenoidDrive: Lesson = {
  id: 'solenoids-pumps-solenoid-drive',
  title: 'Solenoid drive',
  tagline: 'Slam it in hard, then hold it gently',
  formula: (p) => {
    const o = solParams(p)
    return `F = μ₀N²A·I² / 2(g + g₀)²: at ${amps(FULL_A)} ${solenoidForceN(FULL_A, SOL.strokeM).toFixed(1)} N open → ${solenoidForceN(FULL_A, 0).toFixed(0)} N seated · pull-in ${amps(solenoidPullInAmps(o.loadN))}, drop-out ${amps(solenoidDropOutAmps(o.loadN))} · held: P = I²R = ${amps(heldAmps(o))}² × ${SOL.ohms} Ω = ${watts(heldWatts(o))}`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Coil current · force at 2 A', shape: 'dot' },
    { color: RING, label: 'Force at the hold current', shape: 'dot' },
    { color: POWER, label: 'Plunger travel (seated = top)', shape: 'dot' },
    { color: HIGH_V, label: 'Drain voltage · overheating', shape: 'dot' },
  ],
  points: [
    'A push/pull solenoid is a coil round a sliding iron plunger. The field pulls the plunger in to close the air gap with F = B²A / 2μ₀, and B ∝ I / gap, so F ∝ I² / gap²: this 12 V frame solenoid pulls 2.5 N at the full 8 mm stroke and 63 N once seated. Like a relay, it needs far more current to pull in than to stay in (Relay → Coil and contacts).',
    'An ESP32 pin can\'t supply 2 A, so a logic-level MOSFET (IRLZ44N) switches the coil\'s low side and the pin only charges its gate. A diode across the coil, band to +12 V, catches the current at switch-off (Inductor → Flyback spike, Relay → Driving a relay). Without it the drain flies to the FET\'s 55 V avalanche: the plunger lets go faster, but ½LI² is dumped in the FET every time.',
    'Watch the current while it pulls in: it rises, then dips as the plunger moves. The closing gap raises the inductance, and the moving iron induces a back-EMF; smart drivers use that dip to detect seating. τ = L/R grows from 2 ms open to 10 ms seated.',
    'Peak and hold: full 12 V for ~35 ms to pull in, then PWM at 20 kHz. The diode keeps the current flowing through the off-time, so it settles at I ≈ (D·V − (1 − D)·0.7 V) / R. Heat goes as I², so a 25 % hold makes ~1 W instead of 24 W. PWM alone never pulls in; too low a duty and the plunger drops out.',
    'Datasheets rate solenoids by duty cycle (ED %) and maximum on-time: the coil warms with τ ≈ 2 min towards T_amb + P·Rθ. Held at full power this one settles at 265 °C, so 105 °C insulation lasts 49 s from cold and ED ≤ 33 %. Peak-and-hold makes it 100 %. Time is slowed 50×.',
  ],
  controls: [
    { kind: 'choice', key: 'drive', options: opts(DRIVES), initial: 'peakhold' },
    { kind: 'slider', key: 'hold', label: 'Hold duty', min: 10, max: 60, step: 5, initial: 25, format: (v) => `${v} %` },
    { kind: 'slider', key: 'load', label: 'Load', min: 0, max: 2.5, step: 0.25, initial: 1, format: (v) => `${v} N + 1 N spring` },
    { kind: 'choice', key: 'diode', options: opts(DIODE), initial: 'yes' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { cx, cy, len, r } = SD
    const x0 = cx - len / 2
    const x1 = cx + len / 2
    const frame = mat('#7d838c', { metal: 0.3, rough: 0.45 }, true)
    box(scene, [len + 1.4, 0.35, 2.8], frame, [cx, cy - r - 0.35, 0])
    for (const x of [x0 - 0.3, x1 + 0.3]) box(scene, [0.4, 2 * r + 0.7, 2.8], frame, [x, cy - 0.17, 0])
    cylinder(scene, 0.68, POLE - x0 + 0.5, frame, [(POLE + x0 - 0.5) / 2, cy, 0], 'x', 24)
    cylinder(scene, 0.95, len, shellMat('#c7b48a', 0.22), [cx, cy, 0], 'x', 32).castShadow = false
    const winding = coil(scene, { radius: r, length: len, turns: 13, thickness: 0.17 })
    winding.group.position.set(cx, cy, 0)
    const copper = mat('#c8803f', { metal: 0.35, rough: 0.35 }, true)
    winding.group.traverse((o) => o instanceof THREE.Mesh && (o.material = copper))
    const waves = heatWaves(scene, 3, { count: 4, rise: 1.8 })
    waves.group.position.set(cx, cy + r + 0.6, 0)

    const plunger = add(scene, new THREE.Group())
    const iron = mat('#9aa0aa', { metal: 0.35, rough: 0.35 }, true)
    cylinder(plunger, 0.68, SD.plungerL, iron, [SD.plungerL / 2, 0, 0], 'x', 24)
    cylinder(plunger, 0.95, 0.3, STEEL(), [SD.plungerL - 0.15, 0, 0], 'x', 24)
    cylinder(plunger, 0.3, 1.1, STEEL(), [SD.plungerL + 0.5, 0, 0], 'x', 12)
    const spring = coil(scene, { radius: 0.92, length: 1, turns: 7, thickness: 0.06 })
    spring.group.traverse((o) => o instanceof THREE.Mesh && (o.material = STEEL()))
    const pullArrow = arrow(scene, [0, cy + 1.1, 0], [-1, 0, 0], CONVENTIONAL, 0.7)
    const loadArrow = arrow(scene, [0, cy - 1, 0], [1, 0, 0], HEAT, 0.6)
    const pullTag = liveLabel(scene, [0, cy + 2, 0.4], { size: 0.34 })
    const loadTag = liveLabel(scene, [x1 + 2, cy - 2.1, 0.4], { size: 0.28, align: 'left' })
    const gapTag = liveLabel(scene, [cx, cy + 2.7, 0.4], { size: 0.34 })
    const status = liveLabel(scene, [cx, cy + 4, 0.4], { size: 0.44 })
    addLabel(scene, '12 V push/pull', [x0 - 2.6, cy + 0.9, 0.4], GREY, 0.3)
    addLabel(scene, `${SOL.ohms} Ω, ${SOL.strokeM * 1000} mm`, [x0 - 2.6, cy + 0.2, 0.4], GREY, 0.3)
    addLabel(scene, 'stroke 3× long', [x0 - 2.6, cy - 0.5, 0.4], GREY, 0.3)

    const z = SD.lead
    const top = (x: number): V3[] => [[x, cy + r, 0], [x, cy + r + 0.4, 0], [x, cy + r + 0.4, z]]
    const fet = fetPart(scene, [x1 - 0.9, -5.4, 0], 'TO-220', { scale: 1.2 })
    const [dx, dy] = fet.pins.d
    wire(scene, [...top(x0), [x0, SD.y12, z], [x0, SD.y12, 0], [SD.cellX, SD.y12, 0], [SD.cellX, -0.2, 0]], 0.12)
    wire(scene, [...top(x1), [x1, dy + 0.9, z], [dx, dy + 0.9, z], [dx, dy, z], fet.pins.d], 0.12)
    wire(scene, [fet.pins.s, [fet.pins.s[0], SD.yG, 0], [SD.cellX, SD.yG, 0], [SD.cellX, -4.6, 0]], 0.12)
    add(scene, cell(4.4, 1), [SD.cellX, -2.4, 0])
    addLabel(scene, '+12 V', [SD.cellX, 1.2, 0.4], LABEL, 0.34)
    addLabel(scene, 'IRLZ44N', [dx + 2.6, -4.2, 0.4], GREY, 0.3)
    const branch = add(scene, new THREE.Group())
    wire(branch, [[x1, SD.yDi, z], [x0, SD.yDi, z]], 0.1)
    const flyback = diodeAlong(branch, [x1 - 1, SD.yDi, z], [x0 + 1, SD.yDi, z], { scale: 1.1 })
    addLabel(branch, '1N4007', [cx, SD.yDi - 1, z], GREY, 0.28)
    const gx = fet.pins.g[0]
    const gateWire: V3[] = [[gx - 6, fet.pins.g[1] - 0.6, 0], [gx, fet.pins.g[1] - 0.6, 0], fet.pins.g]
    wire(scene, gateWire, 0.08)
    const gateGlow = litWire(scene, gateWire, 0.14)
    addLabel(scene, 'GPIO 25', [gx - 5, fet.pins.g[1], 0.4], PIN_COLOR, 0.32)
    const drainTag = liveLabel(scene, [x1 + 2.2, 1.2, 0.4], { size: 0.32, align: 'left' })

    const zl = z + 0.45
    const coilPts: V3[] = [[x0, cy + r + 0.4, zl], [x1, cy + r + 0.4, zl]]
    const live = { drain: 0 }
    const main = plusFlow(
      scene,
      [[SD.cellX, -0.2, 0.5], [SD.cellX, SD.y12, 0.5], [x0, SD.y12, zl], ...coilPts, [x1, dy + 0.9, zl], [dx, dy + 0.9, zl], [dx, dy - 1.4, z], [fet.pins.s[0], SD.yG, 0.5], [SD.cellX, SD.yG, 0.5], [SD.cellX, -4.6, 0.5]],
      (at) => (at.y < dy - 1 ? 0 : at.x > x1 + 0.1 && at.y < cy ? live.drain / 14 : 1),
    )
    const loop = plusFlow(scene, [...coilPts, [x1, SD.yDi, zl], [x0, SD.yDi, zl]], () => 1, true)

    const plot = scope(scene, SD.sw, 4.2, { divs: [12, 6], zeroAt: 0 })
    plot.group.position.set(SD.sx, 4.4, 0)
    const yP = (f: number) => (f - 0.5) * plot.height
    const tAmps = plot.trace(CONVENTIONAL, { samples: SD.S, radius: 0.06 })
    const tTravel = plot.trace(POWER, { samples: SD.S, radius: 0.05 })
    const tDrain = plot.trace(HIGH_V, { samples: SD.S, radius: 0.05 })
    const cursor = cursorBar(plot, LABEL)
    ticks(plot, [0, 40, 80, 120].map((ms): [number, string] => [ms / 120, `${ms}`]), [0, 1, 2].map((a): [number, string] => [a / 2.5, `${a}`]), 0.32)
    addLabel(scene, 'coil 0…2.5 A · drain 0…60 V · travel, 0…120 ms', [SD.sx, 1.3, 0.3], GREY, 0.3)
    const duty = scope(scene, SD.sw, 1.1, { divs: [12, 1], zeroAt: 0 })
    duty.group.position.set(SD.sx, -0.2, 0)
    const tDuty = duty.trace(PIN_COLOR, { samples: SD.S, radius: 0.05 })
    addLabel(scene, 'gate PWM duty 0…100 %', [SD.sx, -1.2, 0.3], GREY, 0.3)

    const fg = scope(scene, SD.sw, 3.6, { divs: [8, 3], zeroAt: 0 })
    fg.group.position.set(SD.sx, -4.1, 0)
    const yF = (f: number) => ((Math.log10(Math.max(f, 0.1)) + 1) / 3 - 0.5) * fg.height
    const fullCurve = fg.trace(CONVENTIONAL, { samples: 100, radius: 0.06 })
    const holdCurve = fg.trace(RING, { samples: 100, radius: 0.06 })
    const loadLine = fg.level(HEAT)
    const dot = add(fg.group, new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1 })))
    ticks(fg, [0, 0.5, 1].map((u): [number, string] => [u, `${(SOL.strokeM * 1000 * (1 - u)).toFixed(0)}`]), [0.1, 1, 10, 100].map((f): [number, string] => [(Math.log10(f) + 1) / 3, `${f}`]), 0.32)
    addLabel(scene, 'pull 0.1…100 N (log) vs gap, mm: open → seated', [SD.sx, -6.8, 0.3], GREY, 0.3)
    const result = liveLabel(scene, [SD.sx, -7.9, 0.3], { size: 0.36 })
    const code = codeBlock(scene, [-15.4, -9.2, 0.3], 0.32, 4)

    const clock = simClock(0.001 * SD.slow, 2)
    const st = { t: 0, key: '', flash: 0 }
    const none = () => 0
    const tr: Record<'A' | 'T' | 'V' | 'D', (u: number) => number> = { A: none, T: none, V: none, D: none }
    const win = SOLENOID_RUN.windowS
    return {
      scene,
      view: { center: [-2.2, -1.4, 0], radius: 60, polar: 1.46, azimuth: 0.1 },
      frame(dt, p) {
        const o = solParams(p)
        const { run, sum } = solMemo(o)
        const f = run.frames
        const key = solKey(o)
        const t = clock(dt, key, win * 1000) / 1000
        st.t = t
        if (key !== st.key) {
          st.key = key
          const bin = (k: number) => f.slice(Math.floor((k * f.length) / SD.S), Math.max(Math.floor(((k + 1) * f.length) / SD.S), Math.floor((k * f.length) / SD.S) + 1))
          const bins = Array.from({ length: SD.S }, (_, k) => bin(k))
          const A = bins.map((b) => b[0].amps / 2.5)
          const T = bins.map((b) => 0.04 + 0.9 * (1 - b[0].gapM / SOL.strokeM))
          const V = bins.map((b) => Math.max(...b.map((x) => x.drainV)) / 60)
          const D = bins.map((b) => 0.1 + 0.8 * b[0].duty)
          const at = (arr: number[]) => (u: number) => yP(arr[Math.round(u * (SD.S - 1))])
          Object.assign(tr, { A: at(A), T: at(T), V: at(V), D: (u: number) => (D[Math.round(u * (SD.S - 1))] - 0.5) * duty.height })
          fullCurve.draw((u) => yF(solenoidForceN(FULL_A, SOL.strokeM * (1 - u))), null)
          holdCurve.group.visible = o.drive !== 'full'
          holdCurve.draw((u) => yF(solenoidForceN(pwmHoldAmps(o.holdDuty), SOL.strokeM * (1 - u))), null)
          loadLine.set(yF(SOL.springN + o.loadN))
          branch.visible = o.diode
          code(solCode(o))
          const hot = coilSteadyC(heldWatts(o)) > SOL.maxC
          result.set(
            sum.seatS === null
              ? `Never pulls in: needs ${amps(solenoidPullInAmps(o.loadN))}, gets ${amps(o.drive === 'pwm' ? pwmHoldAmps(o.holdDuty) : FULL_A)}`
              : sum.droppedS !== null
                ? o.diode
                  ? `Seated in ${msText(sum.seatS - SOLENOID_RUN.onS)}, dropped out: ${amps(sum.holdAmps)} < ${amps(solenoidDropOutAmps(o.loadN))}`
                  : 'No diode: each PWM off-edge dumps the current, it drops out'
                : hot
                  ? `Seated in ${msText(sum.seatS - SOLENOID_RUN.onS)}, but ${watts(heldWatts(o))} held cooks it to ${coilSteadyC(heldWatts(o)).toFixed(0)} °C`
                  : `Seated in ${msText(sum.seatS - SOLENOID_RUN.onS)}, holds on ${amps(heldAmps(o))}: ${watts(heldWatts(o))}, ${coilSteadyC(heldWatts(o)).toFixed(0)} °C`,
            sum.seatS === null || sum.droppedS !== null || hot ? HIGH_V : POWER,
          )
          heatGlow(copper, (coilSteadyC(heldWatts(o)) - SOL.ambientC) / (2 * (SOL.maxC - SOL.ambientC)))
          st.flash = 0
        }
        const u = t / win
        tAmps.draw(tr.A, u)
        tTravel.draw(tr.T, u)
        tDrain.draw(tr.V, u)
        tDuty.draw(tr.D, u)
        cursor(u)
        const fr = fixedStepAt(f, t, SOLENOID_RUN.dt * SOLENOID_RUN.every)
        const gapShow = (SD.show * fr.gapM) / SOL.strokeM
        const px = POLE + gapShow
        plunger.position.set(px, cy, 0)
        const collar = px + SD.plungerL - 0.3
        const sx0 = x1 + 0.5
        spring.group.scale.x = Math.max(0.2, collar - sx0)
        spring.group.position.set((collar + sx0) / 2, cy, 0)
        const F = fr.forceN
        const pullLen = 0.25 + 0.35 * Math.max(0, Math.log10(Math.max(F, 0.1)) + 1)
        pullArrow.scale.setScalar(pullLen)
        pullArrow.visible = F > 0.1
        pullArrow.position.x = px + SD.plungerL + 0.6
        pullTag.group.position.x = px + SD.plungerL + 0.4
        pullTag.set(F > 0.1 ? `pull ${F < 10 ? F.toFixed(1) : F.toFixed(0)} N` : '', CONVENTIONAL)
        loadArrow.position.x = px + SD.plungerL + 1.3
        loadTag.set(`spring + load ${(SOL.springN + o.loadN).toFixed(1)} N`, HEAT)
        gapTag.set(`gap ${(fr.gapM * 1000).toFixed(1)} mm`, fr.gapM > 0 ? LABEL : POWER)
        const b = solenoidGapB(fr.amps, fr.gapM) / 1.3
        iron.emissive.set(B_FIELD)
        iron.emissiveIntensity = 0.9 * Math.min(1, b)
        frame.emissive.set(B_FIELD)
        frame.emissiveIntensity = 0.35 * Math.min(1, b)
        waves.step(dt, (coilSteadyC(heldWatts(o)) - SOL.maxC) / 100)
        dot.position.set(fg.xAt(1 - fr.gapM / SOL.strokeM), yF(F), 0.3)
        dot.visible = F > 0.1

        const on = fr.duty > 0
        const aval = !o.diode && fr.drainV >= SOLENOID_RUN.breakdownV - 1e-6
        st.flash = aval ? Math.max(st.flash, Math.min(1, 0.25 + fr.amps / FULL_A)) : Math.max(0, st.flash - dt * 2)
        live.drain = fr.drainV
        fet.set(on ? fr.amps / FULL_A : 0, st.flash)
        gateGlow.set(fr.duty > 0 ? 0.3 + 0.6 * fr.duty : 0.05, new THREE.Color(PIN_COLOR))
        const free = !on && o.diode && fr.amps > 1e-3
        flyback.set(free ? Math.min(1, fr.amps / FULL_A + 0.3) : -0.6)
        const speed = dt * 2.2 * fr.amps
        main.mesh.visible = on && fr.amps > 1e-3
        loop.mesh.visible = free || (on && fr.duty < 1 && o.diode)
        main.step(speed * (on ? fr.duty : 0))
        loop.step(speed * (on ? 1 - fr.duty : 1))
        drainTag.set(`drain ${fr.drainV.toFixed(1)} V`, aval ? HIGH_V : LABEL)
        const seatedBefore = sum.seatS !== null && t > sum.seatS
        status.set(
          t < SOLENOID_RUN.onS
            ? 'off'
            : on
              ? fr.gapM > 0
                ? seatedBefore
                  ? 'dropped out'
                  : sum.seatS === null && t > SOLENOID_RUN.onS + 0.02
                    ? 'stuck: not enough pull'
                    : 'pulling in'
                : fr.duty >= 1
                  ? 'seated'
                  : `holding at ${pct(fr.duty)}`
              : fr.gapM < SOL.strokeM
                ? 'releasing'
                : 'released',
          on && fr.gapM > 0 && (seatedBefore || sum.seatS === null) ? HIGH_V : on && fr.gapM <= 0 ? POWER : LABEL,
        )
      },
      readouts: (p) => {
        const o = solParams(p)
        const fr = fixedStepAt(solMemo(o).run.frames, st.t, SOLENOID_RUN.dt * SOLENOID_RUN.every)
        const w = heldWatts(o)
        const T = coilSteadyC(w)
        const noHold = !o.diode && o.drive !== 'full'
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${SD.slow}× slow)` },
          { label: 'Coil', value: `${amps(fr.amps)} · ${watts(coilWatts(fr.amps))}` },
          { label: 'Plunger', value: `${(fr.gapM * 1000).toFixed(1)} mm · ${fr.forceN.toFixed(1)} N`, tone: fr.gapM <= 0 ? 'ok' : 'warn' },
          { label: 'Held on', value: noHold ? 'can\'t hold (no diode)' : `${watts(w)} → ${T.toFixed(0)} °C`, tone: noHold || T > SOL.maxC ? 'bad' : T > 0.7 * SOL.maxC ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Peristaltic pump: rollers push trapped slugs, flow = mL/rev × rpm, stepper vs timed DC dosing; centrifugal needs priming. ---

const PUMPS = { step: 'Peristaltic + stepper', dc: 'Peristaltic + DC motor', cent: 'Centrifugal pump' }
const LINES = { primed: 'Line primed', dry: 'Line dry (air)' }
const LINE_M = 0.4
const LIFT_M = 0.3
const MICRO_REV = 3200
const PP = { cx: -6, cy: 3, rr: 2.1, roller: 0.5, rt: 2.62, tube: 0.3, inX: -11, outX: 0.6, ys: -3.6, bTop: -1.4, bH: 5.2, bR: 0.85, slots: 30, sx: 7.6, sw: 10, hold: 2.5, showS: 12 }
const periParams = (p: Params) => {
  const pump = pick(PUMPS, p.pump, 'step')
  const speed = n(p, 'speed') / 100
  const doseMl = n(p, 'dose')
  const primed = pick(LINES, p.line, 'primed') === 'primed'
  const rpm = pump === 'cent' ? speed * CENTRIFUGAL_12V.maxRpm : speed * 300
  const flow = periFlowMlMin(rpm)
  const runS = doseSeconds(doseMl, flow)
  const realRpm = pump === 'dc' ? rpm * DC_SPEED_FRACTION : rpm
  return { pump, speed, doseMl, primed, rpm, realRpm, flow, runS, k: Math.max(1, Math.ceil(runS / PP.showS)) }
}
type PeriQ = ReturnType<typeof periParams>
const periKey = (q: PeriQ) => `${q.pump}|${q.speed}|${q.doseMl}|${q.primed}`
const primeMl = periPrimeMl(LINE_M)
const thetaAt = (q: PeriQ, t: number) => (Math.min(t, q.runS) * q.realRpm * 2 * Math.PI) / 60
const pumpedAt = (q: PeriQ, t: number) => periDeliveredMl(thetaAt(q, t))
const lineFill = (q: PeriQ, t: number) => (q.primed ? 1 : Math.min(1, pumpedAt(q, t) / primeMl))
const landedAt = (q: PeriQ, t: number) => Math.max(0, pumpedAt(q, t) - (q.primed ? 0 : primeMl))
const centHead = (q: PeriQ) => centrifugalHeadM(q.rpm, q.primed ? WATER_KG_M3 : AIR_KG_M3)

function periCode(q: PeriQ) {
  const rev = periMlPerRev()
  if (q.pump === 'cent') {
    const lpm = centrifugalLpm(q.rpm, LIFT_M, q.primed)
    return [`digitalWrite(PUMP, HIGH);  // ${q.rpm.toFixed(0)} rpm${lpm > 0 ? `, ${lpm.toFixed(1)} L/min` : ''}`, lpm > 0 ? `// ${q.doseMl} mL takes ${msText((q.doseMl / 1000 / lpm) * 60)}: no way to meter it` : q.primed ? `// ${centHead(q).toFixed(2)} m of head < ${LIFT_M} m lift: no flow` : `// in air: ${(centHead(q) * 1000).toFixed(1)} mm of lift, needs ${LIFT_M * 1000} mm`, q.primed ? '// flow sags with head, pulses never counted' : '// fill the pump first (or mount it below the tank)']
  }
  if (q.pump === 'dc') return [`const float ML_PER_S = ${(q.flow / 60).toFixed(3)};  // calibrated at 12 V`, `digitalWrite(PUMP, HIGH);  delay(${(q.runS * 1000).toFixed(0)});  // ${q.doseMl} mL`, `digitalWrite(PUMP, LOW);  // at 11 V it ran ${pct(DC_SPEED_FRACTION)} speed`]
  return [`const float STEPS_PER_ML = ${MICRO_REV} / ${rev.toFixed(4)};  // µsteps/mL`, `stepper.setMaxSpeed(${q.rpm.toFixed(0)} * ${MICRO_REV} / 60);  // ${q.flow.toFixed(1)} mL/min`, `stepper.move(${doseSteps(q.doseMl, MICRO_REV)});  // ${q.doseMl} mL = ${doseRevs(q.doseMl).toFixed(1)} revs`]
}

export const peristalticPump: Lesson = {
  id: 'solenoids-pumps-peristaltic-pump',
  title: 'Peristaltic pump',
  tagline: 'Count turns, get millilitres',
  formula: (p) => {
    const q = periParams(p)
    if (q.pump === 'cent') return `H = ψ·ρ·u² / ρ_w·g, u = ωr = ${tipSpeed(q.rpm).toFixed(2)} m/s → in water ${centrifugalHeadM(q.rpm, WATER_KG_M3).toFixed(2)} m, in air ${(centrifugalHeadM(q.rpm, AIR_KG_M3) * 1000).toFixed(1)} mm · lift needed ${LIFT_M} m`
    return `V_rev = π(${PERI_PUMP.boreMm / 2} mm)² × (2π·${PERI_PUMP.trackMm} − ${PERI_PUMP.rollers}×${PERI_PUMP.pinchMm}) mm = ${periMlPerRev().toFixed(3)} mL · Q = V_rev × rpm = ${periMlPerRev().toFixed(3)} × ${q.rpm.toFixed(0)} = ${q.flow.toFixed(1)} mL/min · ${q.doseMl} mL = ${doseRevs(q.doseMl).toFixed(1)} revs = ${secs(q.runS)}`
  },
  legend: [
    { color: B_FIELD, label: 'Liquid · head in water', shape: 'dot' },
    { color: GREY, label: 'Air in the line · head in air', shape: 'dot' },
    { color: POWER, label: 'Dose delivered', shape: 'dot' },
    { color: RING, label: 'Target dose · lift needed', shape: 'dot' },
  ],
  points: [
    'Rollers on a rotor squeeze a soft tube against a curved bed. Each pinch seals the tube, so the slug of liquid between two rollers is carried round and pushed out. The liquid only touches the tube: nothing to corrode or contaminate, which is why it doses nutrients, reagents and medicine.',
    'It is positive displacement: every turn moves the tube\'s bore area × the track length not under a roller, here 0.21 mL. Flow = mL/rev × rpm, straight-line in speed. Each roller lifting off gives a pulse: 3 rollers, 3 pulses per turn; more rollers run smoother.',
    'Dose = revolutions. A stepper turns exactly, so 5 mL is 24 revs = 76,700 microsteps; the only error is stopping mid-pulse (± 0.006 mL). A DC gearmotor is timed instead, and its speed follows the battery, the load and the tube: calibrated at 12 V, run at 11 V, it under-doses 8 %. Tubes also take a set; recalibrate now and then.',
    'Self-priming: the squeezed tube pulls ~0.8 bar of vacuum, enough to lift water 8 m. But a dry line has to be emptied of air first: 1.3 mL here, lost from the first dose unless you prime before dosing.',
    'A centrifugal pump flings liquid outward with an impeller: Δp ∝ ρ·u², big smooth flow for cheap. Full of air (ρ 800× lower) it makes 800× less pressure, a millimetre or two, so it can\'t pull water up its inlet: it is not self-priming. Mount it below the water line or fill it first, and don\'t dose with it: its flow changes with the head.',
  ],
  controls: [
    { kind: 'choice', key: 'pump', options: opts(PUMPS), initial: 'step' },
    { kind: 'slider', key: 'speed', label: 'Speed', min: 10, max: 100, step: 10, initial: 50, format: (v) => `${v} %` },
    { kind: 'slider', key: 'dose', label: 'Dose', min: 1, max: 10, step: 1, initial: 5, format: (v) => `${v} mL` },
    { kind: 'choice', key: 'line', options: opts(LINES), initial: 'primed' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { cx, cy, rt } = PP
    const liquid = new THREE.MeshStandardMaterial({ color: B_FIELD, emissive: B_FIELD, emissiveIntensity: 0.35, transparent: true, opacity: 0.85, roughness: 0.2 })
    const air = new THREE.MeshStandardMaterial({ color: GREY, emissive: GREY, emissiveIntensity: 0.15, transparent: true, opacity: 0.6, roughness: 0.3 })
    const glass = () => shellMat('#dfe9f5', 0.16)
    const tubeOf = (parent: THREE.Object3D, pts: V3[], r: number, m: THREE.Material, seg = 120) => {
      const geo = new THREE.TubeGeometry(path(pts), seg, r, 10)
      const msh = add(parent, new THREE.Mesh(geo, m))
      msh.castShadow = false
      return { msh, reveal: (f: number) => geo.setDrawRange(0, Math.round(clamp01(f) * seg) * 10 * 6) }
    }

    const tank = add(scene, new THREE.Group())
    box(tank, [7.2, 2.8, 3], glass(), [-8.6, PP.ys - 1, 0])
    box(tank, [7, 2.2, 2.8], liquid, [-8.6, PP.ys - 1.3, 0])
    addLabel(tank, `tank, ${LIFT_M * 1000} mm below the pump`, [-8.6, PP.ys - 3.1, 0.4], GREY, 0.3)
    const bx = PP.outX
    cylinder(scene, PP.bR, PP.bH, glass(), [bx, PP.bTop - PP.bH / 2, 0], 'y', 32).castShadow = false
    const fill = cylinder(scene, PP.bR - 0.1, 1, liquid, [bx, 0, 0], 'y', 32)
    fill.castShadow = false
    const bBase = PP.bTop - PP.bH
    for (const ml of [2, 4, 6, 8, 10]) addLabel(scene, `${ml}`, [bx + PP.bR + 0.45, bBase + (ml / 10) * PP.bH, 0.3], GREY, 0.26)
    const target = add(scene, new THREE.Mesh(new THREE.TorusGeometry(PP.bR + 0.05, 0.06, 8, 32), glowMat(RING, 1.2)))
    target.rotation.x = Math.PI / 2
    addLabel(scene, 'mL', [bx, bBase - 0.6, 0.3], GREY, 0.28)
    const drops = Array.from({ length: 4 }, () => add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), liquid)))

    const peri = add(scene, new THREE.Group())
    const plate = mat('#2b2e35', { rough: 0.55 })
    box(peri, [7.2, 7.2, 0.5], plate, [cx, cy, -0.9])
    const bedShape = new THREE.Shape()
    bedShape.absarc(0, 0, rt + PP.tube + 0.7, Math.PI, 2 * Math.PI, false)
    bedShape.absarc(0, 0, rt + PP.tube, 2 * Math.PI, Math.PI, true)
    const bed = add(peri, new THREE.Mesh(new THREE.ExtrudeGeometry(bedShape, { depth: 1.2, bevelEnabled: false }), mat('#d9dde3', { rough: 0.5 })), [cx, cy, -0.6])
    bed.castShadow = false
    const arcPts = Array.from({ length: 41 }, (_, i): V3 => {
      const a = Math.PI + (Math.PI * i) / 40
      return [cx + rt * Math.cos(a), cy + rt * Math.sin(a), 0]
    })
    const inPts: V3[] = [[PP.inX, PP.ys - 0.6, 0], [PP.inX, cy, 0], [cx - rt, cy, 0]]
    const outPts: V3[] = [[cx + rt, cy, 0], [bx, cy, 0], [bx, PP.bTop + 0.5, 0]]
    tubeOf(peri, [...inPts.slice(0, -1), ...arcPts, ...outPts.slice(1)], PP.tube, shellMat('#eef3f8', 0.28), 240)
    const inLiq = tubeOf(peri, inPts, PP.tube * 0.7, liquid)
    const outLiq = tubeOf(peri, outPts, PP.tube * 0.7, liquid)
    const inAir = tubeOf(peri, inPts, PP.tube * 0.55, air)
    const outAir = tubeOf(peri, outPts, PP.tube * 0.55, air)
    const lenIn = path(inPts).getLength()
    const lenOut = path(outPts).getLength()
    const split = lenIn / (lenIn + lenOut)

    const rotor = add(peri, new THREE.Group(), [cx, cy, 0])
    cylinder(rotor, PP.rr + 0.15, 0.3, mat('#5d636c', { metal: 0.3, rough: 0.4 }), [0, 0, -0.45], 'z', 40)
    cylinder(rotor, 0.4, 0.8, STEEL(), [0, 0, 0], 'z', 20)
    const rollerAt = (k: number) => (2 * Math.PI * k) / PERI_PUMP.rollers
    for (let k = 0; k < PERI_PUMP.rollers; k++) {
      const a = rollerAt(k)
      rod(rotor, [0, 0, 0.2], [PP.rr * Math.cos(a), PP.rr * Math.sin(a), 0.2], 0.16, mat('#5d636c', { metal: 0.3, rough: 0.4 }))
      cylinder(rotor, PP.roller, 0.9, mat('#e8e8ea', { rough: 0.35 }), [PP.rr * Math.cos(a), PP.rr * Math.sin(a), 0], 'z', 24)
    }
    const slugGeo = new THREE.SphereGeometry(0.2, 10, 8)
    const slugs = Array.from({ length: PP.slots }, (_, j) => {
      const a = (2 * Math.PI * j) / PP.slots
      const near = Array.from({ length: PERI_PUMP.rollers }, (__, k) => Math.abs(wrapPi(a - rollerAt(k)))).some((d) => d < 0.32)
      const m = add(rotor, new THREE.Mesh(slugGeo, liquid), [rt * Math.cos(a), rt * Math.sin(a), 0])
      m.castShadow = false
      return { m, a, near }
    })
    addLabel(peri, `3 rollers · ${PERI_PUMP.boreMm} mm tube`, [cx, cy + rt + 1.3, 0.4], GREY, 0.3)

    const stepMotor = nema17(peri, [-12.4, 7.4, 0], 0.75)
    const dcMotor = motorCan(peri, [-12.4, 7.4, 0], { r: 1.1, legs: 0.3 })
    const motorTag = liveLabel(peri, [-12.4, 5.2, 0.4], { size: 0.3 })
    addLabel(peri, 'turns the rotor', [-12.4, 9.4, 0.4], GREY, 0.28)

    const cent = add(scene, new THREE.Group())
    cylinder(cent, 2.4, 1.4, shellMat('#dfe9f5', 0.22), [cx, cy, 0], 'z', 40).castShadow = false
    const centWater = cylinder(cent, 2.25, 0.5, liquid, [cx, cy, -0.4], 'z', 40)
    const impeller = add(cent, new THREE.Group(), [cx, cy, 0.3])
    cylinder(impeller, 0.5, 0.9, STEEL(), [0, 0, 0], 'z', 20)
    for (let k = 0; k < 6; k++) {
      const vane = add(impeller, new THREE.Group())
      vane.rotation.z = (k * Math.PI) / 3
      box(vane, [1.6, 0.18, 0.8], mat('#3b82c4', { rough: 0.4 }), [1.2, 0.25, 0]).rotation.z = 0.35
    }
    const pipe = shellMat('#eef3f8', 0.28)
    const cIn: V3[] = [[cx, PP.ys - 0.6, 0], [cx, cy - 2.4, 0]]
    const cOut: V3[] = [[cx + 1.6, cy + 1.8, 0], [cx + 1.6, cy + 3, 0], [bx, cy + 3, 0], [bx, PP.bTop + 0.5, 0]]
    for (const pts of [cIn, cOut]) add(cent, new THREE.Mesh(new THREE.TubeGeometry(path(pts), 60, 0.42, 12), pipe)).castShadow = false
    const cInLiq = cylinder(cent, 0.32, 1, liquid, [cx, 0, 0], 'y', 16)
    const cOutLiq = add(cent, new THREE.Mesh(new THREE.TubeGeometry(path(cOut), 60, 0.3, 10), liquid))
    addLabel(cent, '12 V impeller pump', [cx - 4.8, cy + 1.2, 0.4], GREY, 0.3)
    const centTag = liveLabel(cent, [cx - 3.2, cy - 3.4, 0.4], { size: 0.32, align: 'right' })
    const status = liveLabel(scene, [cx, cy + 5.2, 0.4], { size: 0.42 })

    const dosePlot = scope(scene, PP.sw, 4.2, { divs: [10, 5], zeroAt: 0 })
    dosePlot.group.position.set(PP.sx, 3.8, 0)
    const yD = (ml: number) => (ml / 10 - 0.5) * dosePlot.height
    const tDose = dosePlot.trace(POWER, { samples: 300, radius: 0.07 })
    const tAir = dosePlot.trace(GREY, { samples: 300, radius: 0.05 })
    const targetLine = dosePlot.level(RING)
    ticks(dosePlot, [], [0, 5, 10].map((v): [number, string] => [v / 10, `${v}`]), 0.32)
    const doseCap = liveLabel(scene, [PP.sx, 1.1, 0.3], { size: 0.3, color: GREY })
    const pulsePlot = scope(scene, PP.sw, 2.6, { divs: [6, 2], zeroAt: 0 })
    pulsePlot.group.position.set(PP.sx, -1.6, 0)
    const tPulse = pulsePlot.trace(B_FIELD, { samples: 120, radius: 0.06 })
    const pulseCursor = cursorBar(pulsePlot, LABEL)
    const pulseCap = add(scene, new THREE.Group())
    addLabel(pulseCap, 'flow / average 0…2 over one rotor turn', [PP.sx, -3.4, 0.3], GREY, 0.3)

    const headPlot = scope(scene, PP.sw, 4.2, { divs: [6, 4], zeroAt: 0 })
    headPlot.group.position.set(PP.sx, -1.2, 0)
    const yH = (m: number) => ((Math.log10(Math.max(m, 1e-3)) + 3) / 4 - 0.5) * headPlot.height
    const tWater = headPlot.trace(B_FIELD, { samples: 100, radius: 0.06 })
    const tAirHead = headPlot.trace(GREY, { samples: 100, radius: 0.06 })
    headPlot.level(RING).set(yH(LIFT_M))
    const headDot = add(headPlot.group, new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), glowMat('#ffffff', 1)))
    ticks(headPlot, [0, 0.5, 1].map((u): [number, string] => [u, `${u * CENTRIFUGAL_12V.maxRpm}`]), [0.001, 0.01, 0.1, 1, 10].map((m): [number, string] => [(Math.log10(m) + 3) / 4, `${m}`]), 0.3)
    const headCap = add(scene, new THREE.Group())
    addLabel(headCap, 'head, m of water (log) vs rpm', [PP.sx, -4.4, 0.3], GREY, 0.3)
    const result = liveLabel(scene, [PP.sx, -5.7, 0.3], { size: 0.36 })
    const code = codeBlock(scene, [-14.6, -8.6, 0.3], 0.32, 3)

    const st = { t: 0, key: '', angle: 0, spin: 0 }
    return {
      scene,
      view: { center: [-2.6, -0.4, 0], radius: 58, polar: 1.46, azimuth: 0.1 },
      frame(dt, p) {
        const q = periParams(p)
        const key = periKey(q)
        const isCent = q.pump === 'cent'
        if (key !== st.key) {
          st.key = key
          st.t = 0
          peri.visible = !isCent
          cent.visible = isCent
          stepMotor.group.visible = q.pump === 'step'
          dcMotor.group.visible = q.pump === 'dc'
          motorTag.set(isCent ? '' : q.pump === 'step' ? 'NEMA17' : 'DC gearmotor', GREY)
          for (const o of [dosePlot.group, pulsePlot.group, pulseCap, doseCap.group]) o.visible = !isCent
          for (const o of [headPlot.group, headCap]) o.visible = isCent
          const tEnd = q.runS * 1.15
          tAir.group.visible = !q.primed
          tAir.draw((u) => yD(Math.min(10, Math.max(0, Math.min(pumpedAt(q, u * tEnd), primeMl)))), null)
          targetLine.set(yD(q.doseMl))
          target.position.set(bx, bBase + (q.doseMl / 10) * PP.bH, 0)
          target.visible = !isCent
          doseCap.set(`dose 0…10 mL vs time 0…${secs(tEnd)}`, GREY)
          tPulse.draw((u) => (periPulse(u * 2 * Math.PI) / 2 - 0.5) * pulsePlot.height, null)
          tWater.draw((u) => yH(centrifugalHeadM(u * CENTRIFUGAL_12V.maxRpm, WATER_KG_M3)), null)
          tAirHead.draw((u) => yH(centrifugalHeadM(u * CENTRIFUGAL_12V.maxRpm, AIR_KG_M3)), null)
          headDot.position.set(headPlot.xAt(q.speed), yH(centHead(q)), 0.3)
          code(periCode(q))
          const lands = dosedMl(q.pump === 'dc' ? 'dc' : 'stepper', q.doseMl, q.primed, LINE_M)
          const lpm = centrifugalLpm(q.rpm, LIFT_M, q.primed)
          const off = lands - q.doseMl
          result.set(
            isCent
              ? lpm > 0
                ? `Primed: lifts ${LIFT_M} m at ${lpm.toFixed(1)} L/min`
                : q.primed
                  ? `Too slow: ${centHead(q).toFixed(2)} m head < ${LIFT_M} m lift`
                  : `Air-bound: ${(centHead(q) * 1000).toFixed(1)} mm head, spins dry`
              : Math.abs(off) < 0.01
                ? `${lands.toFixed(2)} mL, within ±${periPulseErrorMl().toFixed(3)} mL`
                : `Landed ${lands.toFixed(2)} mL (${pct(off / q.doseMl).replace('-', '−')}): ${[q.pump === 'dc' ? 'slow motor' : '', q.primed ? '' : 'dry line'].filter(Boolean).join(', ')}`,
            isCent ? (lpm > 0 ? POWER : HIGH_V) : Math.abs(off) < 0.01 ? POWER : HIGH_V,
          )
        }
        const shown = isCent ? 0 : q.runS + PP.hold * q.k
        st.t += dt * (isCent ? 1 : q.k)
        if (!isCent && st.t > shown) st.t = 0
        const t = st.t
        if (isCent) {
          const lpm = centrifugalLpm(q.rpm, LIFT_M, q.primed)
          st.spin -= dt * 2 * Math.PI * (0.5 + 2 * q.speed)
          impeller.rotation.z = st.spin
          const hAir = centHead(q)
          const lift = cy - 2.4 - (PP.ys - 0.6)
          const col = lpm > 0 ? lift : Math.min(lift, Math.max(0.05, (hAir / LIFT_M) * lift))
          cInLiq.scale.y = col
          cInLiq.position.y = PP.ys - 0.6 + col / 2
          centWater.visible = cOutLiq.visible = lpm > 0
          fill.scale.y = lpm > 0 ? PP.bH * 0.98 : 0.01
          centTag.set(lpm > 0 ? `${lpm.toFixed(1)} L/min` : `water rises ${(hAir * 1000).toFixed(1)} mm`, lpm > 0 ? B_FIELD : HIGH_V)
          status.set(lpm > 0 ? 'pumping' : q.primed ? 'not enough head' : 'air-bound: spinning dry', lpm > 0 ? POWER : HIGH_V)
          drops.forEach((d, i) => {
            d.visible = lpm > 0
            d.position.set(bx, PP.bTop + 0.4 - frac(t * 3 + i / drops.length) * 0.9, 0)
          })
        } else {
          const theta = thetaAt(q, t)
          const running = t < q.runS
          rotor.rotation.z = theta
          stepMotor.set(theta, 0.7, 0.7)
          if (running) dcMotor.spin(dt, q.realRpm * q.k)
          const f = lineFill(q, t)
          const fIn = Math.min(1, f / split)
          const fOut = Math.max(0, (f - split) / (1 - split))
          inLiq.reveal(fIn)
          inAir.reveal(1)
          outLiq.reveal(fOut)
          outAir.reveal(1)
          inAir.msh.visible = fIn < 1
          outAir.msh.visible = fOut < 1
          for (const s of slugs) {
            const world = wrap2pi(s.a + theta)
            s.m.visible = !s.near && world > Math.PI + 0.08 && world < 2 * Math.PI - 0.08
            s.m.material = fIn >= 1 ? liquid : air
          }
          const landed = landedAt(q, t)
          fill.scale.y = Math.max(0.01, (landed / 10) * PP.bH)
          const dripping = running && landed > 0
          drops.forEach((d, i) => {
            d.visible = dripping
            d.position.set(bx, PP.bTop + 0.4 - frac(t * 1.5 + i / drops.length) * 0.9, 0)
          })
          const tEnd = q.runS * 1.15
          tDose.draw((u) => yD(Math.min(10, landedAt(q, u * tEnd))), Math.min(1, t / tEnd))
          pulseCursor(wrap2pi(theta) / (2 * Math.PI))
          status.set(running ? (f < 1 ? 'pulling air out of the line' : 'dosing') : 'stopped', running ? (f < 1 ? HEAT : POWER) : LABEL)
        }
        fill.position.y = bBase + fill.scale.y / 2
      },
      readouts: (p) => {
        const q = periParams(p)
        if (q.pump === 'cent') {
          const lpm = centrifugalLpm(q.rpm, LIFT_M, q.primed)
          return [
            { label: 'Impeller', value: `${q.rpm.toFixed(0)} rpm, u = ${tipSpeed(q.rpm).toFixed(1)} m/s` },
            { label: 'Head', value: `${centrifugalHeadM(q.rpm, WATER_KG_M3).toFixed(2)} m water · ${(centrifugalHeadM(q.rpm, AIR_KG_M3) * 1000).toFixed(1)} mm air` },
            { label: 'Flow', value: lpm > 0 ? `${lpm.toFixed(1)} L/min` : '0 (can\'t lift)', tone: lpm > 0 ? 'ok' : 'bad' },
          ]
        }
        const landed = landedAt(q, st.t)
        return [
          { label: 'Sim time', value: `${secs(st.t)}${q.k > 1 ? ` (${q.k}× fast)` : ''}` },
          { label: 'Flow', value: `${periMlPerRev().toFixed(3)} mL/rev × ${q.realRpm.toFixed(0)} rpm` },
          { label: 'Delivered', value: `${landed.toFixed(2)} / ${q.doseMl} mL`, tone: st.t < q.runS ? undefined : Math.abs(landed - q.doseMl) < 0.01 ? 'ok' : 'bad' },
        ]
      },
    }
  },
}
