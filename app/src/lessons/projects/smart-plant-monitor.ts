import * as THREE from 'three/webgpu'
import {
  GPIO_VDD,
  PLANT_CALS,
  PLANT_CAP,
  PLANT_CTRL,
  PLANT_DRIVERS,
  PLANT_FORK,
  PLANT_PINS,
  PLANT_POT,
  PLANT_PROBES,
  PLANT_RIG,
  PLANT_SOIL,
  PLANT_STRATEGIES,
  PLANT_TANKS,
  PlantCal,
  PlantDriver,
  PlantPin,
  PlantProbe,
  PlantStrategy,
  doseSeconds,
  fixedStepAt,
  plantBenchMlS,
  plantCalPct,
  plantForkOhms,
  plantProbe,
  plantProbeRaw,
  plantPumpDrive,
  plantRun,
  plantSoilPct,
  toppEps,
} from '../../core/physics'
import { amps as ampText, fixedText, hoursText, ohms, pct, volts } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CODE_LEGEND,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  cableRun,
  codeBlock,
  cursorBar,
  esp32Board,
  fetPart,
  frac,
  glowMat,
  liveLabel,
  memoBy,
  relayPart,
  scope,
  setGlow,
  shellMat,
  statusHeader,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const VIEW = { center: [-2.4, -0.8, 0] as V3, radius: 50, polar: Math.PI / 2, azimuth: 0 }
const DRY_SOIL = new THREE.Color('#a8825a')
const WET_SOIL = new THREE.Color('#2e1f14')
const COPPER = '#c98a4b'

/** Terracotta pot, face-on and cut open: soil (`set(f)` darkens 0 dry … 1 wet) behind a see-through front. */
function plantPot(parent: THREE.Object3D, at: V3, w: number, h: number) {
  const g = add(parent, new THREE.Group(), at)
  const clay = mat('#b5653d', { rough: 0.8 })
  box(g, [w, 0.4, 2.4], clay, [0, -h / 2, 0])
  for (const s of [-1, 1]) box(g, [0.4, h, 2.4], clay, [(s * w) / 2, 0, 0])
  box(g, [w + 1, 0.5, 2.6], clay, [0, h / 2, 0])
  box(g, [w, h, 0.15], shellMat('#e6c8b4', 0.12), [0, 0, 1.2])
  const soilMat = new THREE.MeshStandardMaterial({ color: DRY_SOIL.clone(), roughness: 0.95 })
  box(g, [w - 0.4, h * 0.82, 2.2], soilMat, [0, -h * 0.09 + 0.1, 0])
  const leaf = mat('#3f9b4a', { rough: 0.6 })
  const stem = add(g, new THREE.Group(), [-w * 0.15, h * 0.32, 0])
  box(stem, [0.25, 3, 0.25], leaf, [0, 1.5, 0])
  for (const [x, y, r] of [[-0.9, 2.2, 0.6], [0.9, 2.9, -0.6], [-0.7, 3.4, 0.4]] as const) box(stem, [1.6, 0.18, 0.7], leaf, [x, y, 0]).rotation.z = r
  return {
    group: g,
    stem,
    set(f: number) {
      soilMat.color.copy(DRY_SOIL).lerp(WET_SOIL, Math.min(1, Math.max(0, f)))
    },
  }
}

// --- Moisture probe: resistive fork vs capacitive board on the ESP32 ADC, calibrated in air/water or in the pot. ---

const PROBE_NAMES = namesOf(PLANT_PROBES)
const PIN_NAMES = namesOf(PLANT_PINS)
const CAL_NAMES = namesOf(PLANT_CALS)
const mpParams = (p: Params) => ({
  probe: pick(PROBE_NAMES, p.probe, 'cap') as PlantProbe,
  theta: n(p, 'theta') / 100,
  pin: pick(PIN_NAMES, p.pin, 'adc1') as PlantPin,
  cal: pick(CAL_NAMES, p.cal, 'air') as PlantCal,
})
const TH_MAX = 0.45
const POT = { x: -13.4, y: -3.2, w: 5.2, h: 5.6 }
const RP = { x: 4.8, y: 0.9, w: 12.6, h: 3.6 }
const PCT = { x: 4.8, y: -5.0, w: 12.6, h: 3.4 }
const lifeText = (d: number) => (d === Infinity ? 'no DC in the soil' : d > 3650 ? 'decades' : d > 365 ? `${fixedText(d / 365, 1)} years` : `${Math.round(d)} days`)

export const smartPlantMonitorMoistureProbe: Lesson = {
  id: 'smart-plant-monitor-moisture-probe',
  title: 'Moisture probe',
  tagline: 'A soil probe on the ESP32 ADC: the cheap fork corrodes, the capacitive board lasts, and both read nonsense until you calibrate them in the pot',
  formula: (p) => {
    const q = mpParams(p)
    const r = plantProbe(q.probe, q.theta, q.pin, q.cal)
    const mapped = r.pct === null ? 'ADC2 busy with Wi-Fi' : `(${r.dryRaw} − ${r.raw}) / (${r.dryRaw} − ${r.wetRaw}) = ${pct(r.pct)}`
    const v =
      PLANT_PROBES[q.probe].kind === 'cap'
        ? `ε = 3.03 + 9.3θ + 146θ² − 76.7θ³ = ${fixedText(toppEps(q.theta), 1)} · V = ${PLANT_CAP.vTop} / (1 + ${PLANT_CAP.cPar} + ${PLANT_CAP.cField}·ε) = ${volts(r.volts)}`
        : `R = ${ohms(PLANT_FORK.fcOhms)} × (${PLANT_SOIL.fcTheta} / θ)² = ${ohms(plantForkOhms(q.theta))} · V = 3.3 V × R / (R + 10 kΩ) = ${volts(r.volts)}`
    return `θ = ${pct(q.theta)} vol · ${v} · % = ${mapped}`
  },
  legend: [
    { color: RING, label: 'Raw ADC reading / % shown', shape: 'dot' },
    { color: GREY, label: 'True: dry pot 0 %, watered 100 %', shape: 'dot' },
    { color: POWER, label: 'Calibration points', shape: 'dot' },
    { color: HIGH_V, label: 'Corroding tine / unreadable', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Two cheap probes. The resistive fork (YL-69) passes current through the soil between two tines: wet soil conducts, so the voltage on a 10 kΩ divider drops (Electricity › Voltage dividers). The capacitive v1.2 board never touches the water: its plates under the solder mask form a capacitor whose value rises with the soil’s permittivity (water ε 80, dry soil ~3), and a 555 + RC filter turns that into a falling voltage.',
    `Soil water is θ, the volume fraction: a wilting dry pot is ~${pct(PLANT_SOIL.dryTheta)}, just watered and drained ("field capacity") ~${pct(PLANT_SOIL.fcTheta)}, saturated ~${pct(PLANT_SOIL.satTheta)}. Neither probe is linear in θ.`,
    'Calibrate before you trust it: read the dry and the wet end, then map() + constrain(). In air / a glass of water is the tutorial way, but no pot is ever as dry as air or as wet as water, so a perfectly watered pot shows ~40–50 %. Calibrate in your own mix: bone-dry pot and freshly watered pot.',
    'An always-on fork is electrolysis: DC through wet soil dissolves the + tine’s copper in weeks (and poisons the plant a little). Power it from a GPIO only for the 10 ms read and it lasts for years. The capacitive board avoids the problem: seal the cut top edge with nail varnish or hot glue.',
    'Use an ADC1 pin (GPIO 32–39): ADC2 is taken by the Wi-Fi driver, and the monitor needs Wi-Fi to send its alerts (Microcontrollers › ADC › ESP32 ADC quirks). analogRead() defaults to 11 dB, 0…3.1 V, slightly bent at the ends.',
  ],
  controls: [
    { kind: 'choice', key: 'probe', options: opts(PROBE_NAMES), initial: 'cap' },
    { kind: 'slider', key: 'theta', label: 'Soil water θ', min: 5, max: 45, step: 1, initial: 30, format: (v) => `${v} % vol` },
    { kind: 'choice', key: 'cal', options: opts(CAL_NAMES), initial: 'air' },
    { kind: 'choice', key: 'pin', options: opts(PIN_NAMES), initial: 'adc1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const pot = plantPot(scene, [POT.x, POT.y, 0], POT.w, POT.h)
    const probeAt: V3 = [POT.x + 1.2, POT.y + POT.h / 2 - 0.4, 1.4]
    const fork = add(scene, new THREE.Group(), probeAt)
    const tineMat = mat(COPPER, { metal: 0.6, rough: 0.35 })
    const anodeMat = new THREE.MeshStandardMaterial({ color: COPPER, metalness: 0.6, roughness: 0.35, emissive: HIGH_V, emissiveIntensity: 0 })
    box(fork, [2.4, 1.6, 0.2], mat('#1f6b3a', { rough: 0.5 }), [0, 1.1, 0])
    box(fork, [0.45, 4.6, 0.12], tineMat, [-0.65, -1.7, 0])
    const anode = box(fork, [0.45, 4.6, 0.12], anodeMat, [0.65, -1.7, 0])
    addLabel(fork, '−', [-0.65, 0.6, 0.3], LABEL, 0.4)
    addLabel(fork, '+', [0.65, 0.6, 0.3], HIGH_V, 0.4)
    const cap = add(scene, new THREE.Group(), probeAt)
    box(cap, [1.5, 6.4, 0.18], mat('#141418', { rough: 0.5 }), [0, -0.9, 0])
    box(cap, [1.0, 1.0, 0.3], mat('#2a2a30'), [0, 1.8, 0.1])
    box(cap, [2.25, 0.08, 0.2], mat('#eef0f3'), [0, 0.4, 0.05])
    addLabel(cap, 'v1.2', [0, 1.0, 0.25], LABEL, 0.28)
    const lifeTag = liveLabel(scene, [POT.x, POT.y - POT.h / 2 - 1.6, 0.3], { size: 0.26 })
    const potTag = liveLabel(scene, [POT.x, POT.y - POT.h / 2 - 0.9, 0.3], { size: 0.32 })
    const espAt: V3 = [-7.6, 1.4, 0]
    const esp = esp32Board(scene, espAt, 0.26)
    const pinTag = liveLabel(scene, [espAt[0], espAt[1] - 2.6, 0.3], { size: 0.28 })
    const wires = add(scene, new THREE.Group())
    const head: V3 = [probeAt[0], probeAt[1] + 2.0, 1.6]
    cableRun(wires, [head, [head[0], 3.2, 1.6], [esp(-4, false)[0], 3.2, 1.6], [esp(-4, false)[0], esp(-4, false)[1], 1.2]], '#d8322c', 0.07)
    const sig = new THREE.MeshStandardMaterial({ color: RING, emissive: RING, emissiveIntensity: 0.6 })
    const sigWire = add(scene, new THREE.Group())
    const sigTo = (x: number) => {
      sigWire.clear()
      const pts: V3[] = [[head[0] + 0.4, head[1], 1.7], [head[0] + 0.4, 2.8, 1.7], [x, 2.8, 1.7], [x, esp(0, false)[1], 1.3]]
      for (let i = 0; i < pts.length - 1; i++) stretchRod(addRod(sigWire, sig), pts[i], pts[i + 1], 0.07)
    }

    const rp = scope(scene, RP.w, RP.h, { divs: [9, 4], zeroAt: 0 })
    rp.group.position.set(RP.x, RP.y, 0)
    addLabel(scene, 'Raw ADC reading vs soil water', [RP.x - RP.w / 2, RP.y + RP.h / 2 + 0.9, 0.3], LABEL, 0.3, 'left')
    const rawTag = liveLabel(scene, [RP.x + RP.w / 2, RP.y + RP.h / 2 + 0.9, 0.3], { size: 0.3, align: 'right' })
    addLabel(scene, '4095', [RP.x - RP.w / 2 - 0.4, RP.y + RP.h / 2, 0.3], GREY, 0.24, 'right')
    addLabel(scene, '0', [RP.x - RP.w / 2 - 0.4, RP.y - RP.h / 2, 0.3], GREY, 0.24, 'right')
    const rawTr = rp.trace(RING, { samples: 120, radius: 0.07 })
    const dryLv = rp.level(POWER)
    const wetLv = rp.level(POWER)
    const dryTag = liveLabel(rp.group, [-RP.w / 2 + 0.3, 0, 0.2], { size: 0.24, align: 'left', color: POWER })
    const wetTag = liveLabel(rp.group, [-RP.w / 2 + 0.3, 0, 0.2], { size: 0.24, align: 'left', color: POWER })
    const rpCursor = cursorBar(rp, LABEL, 0.06)
    const pp = scope(scene, PCT.w, PCT.h, { divs: [9, 4], zeroAt: 0 })
    pp.group.position.set(PCT.x, PCT.y, 0)
    addLabel(scene, 'Moisture % shown vs true', [PCT.x - PCT.w / 2, PCT.y + PCT.h / 2 + 0.9, 0.3], LABEL, 0.3, 'left')
    const pctTag = liveLabel(scene, [PCT.x + PCT.w / 2, PCT.y + PCT.h / 2 + 0.9, 0.3], { size: 0.3, align: 'right' })
    addLabel(scene, '100 %', [PCT.x - PCT.w / 2 - 0.4, PCT.y + PCT.h / 2, 0.3], GREY, 0.24, 'right')
    addLabel(scene, '0', [PCT.x - PCT.w / 2 - 0.4, PCT.y - PCT.h / 2, 0.3], GREY, 0.24, 'right')
    for (const th of [0.05, 0.15, 0.25, 0.35, 0.45]) addLabel(scene, `${Math.round(th * 100)}`, [PCT.x - PCT.w / 2 + (th / TH_MAX) * PCT.w, PCT.y - PCT.h / 2 - 0.6, 0.3], GREY, 0.24)
    addLabel(scene, 'θ, % vol', [PCT.x + PCT.w / 2, PCT.y - PCT.h / 2 - 1.2, 0.3], GREY, 0.24, 'right')
    const trueTr = pp.trace(GREY, { samples: 100, radius: 0.05 })
    const shownTr = pp.trace(RING, { samples: 100, radius: 0.07 })
    const ppCursor = cursorBar(pp, LABEL, 0.06)
    const code = codeBlock(scene, [-17.2, -8.6, 0.3], 0.24, 3)
    const ry = (raw: number) => (raw / 4095 - 0.5) * RP.h
    const py = (f: number) => (f - 0.5) * PCT.h
    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = mpParams(p)
        const r = plantProbe(q.probe, q.theta, q.pin, q.cal)
        const isCap = PLANT_PROBES[q.probe].kind === 'cap'
        const key = `${q.probe}|${q.theta}|${q.pin}|${q.cal}`
        st.t += dt
        if (key !== st.key) {
          st.key = key
          fork.visible = !isCap
          cap.visible = isCap
          pot.set(q.theta / PLANT_SOIL.satTheta)
          pot.stem.rotation.z = q.theta < PLANT_SOIL.dryTheta + 0.02 ? -0.5 : 0
          const u = q.theta / TH_MAX
          rawTr.draw((x) => ry(plantProbeRaw(q.probe, Math.max(0.01, x * TH_MAX))), u)
          dryLv.set(ry(r.dryRaw))
          wetLv.set(ry(r.wetRaw))
          dryTag.group.position.y = ry(r.dryRaw) + 0.35
          wetTag.group.position.y = ry(r.wetRaw) - 0.35
          dryTag.set(`dry ${r.dryRaw}`, POWER)
          wetTag.set(`wet ${r.wetRaw}`, POWER)
          rpCursor(u)
          ppCursor(u)
          trueTr.draw((x) => py(Math.min(1, Math.max(0, plantSoilPct(x * TH_MAX)))), u)
          shownTr.group.visible = r.raw !== null
          shownTr.draw((x) => py(plantCalPct(plantProbeRaw(q.probe, Math.max(0.01, x * TH_MAX)), r.dryRaw, r.wetRaw)), u)
          rawTag.set(r.raw === null ? 'ADC2 busy (Wi-Fi)' : `${volts(r.volts)} → ${r.raw}`, r.raw === null ? HIGH_V : RING)
          pctTag.set(r.pct === null ? '—' : `shows ${pct(r.pct)} · true ${pct(r.truePct)}`, r.pct === null ? HIGH_V : Math.abs(r.err!) < 0.1 ? POWER : HEAT)
          pinTag.set(PLANT_PINS[q.pin].name, r.readable ? RING : HIGH_V)
          sigTo(esp(q.pin === 'adc1' ? 2 : 6, false)[0])
          setGlow(sig, r.readable ? RING : HIGH_V, 0.6)
          const days = r.life.days
          anodeMat.color.set(days < 120 ? '#5f9c7d' : COPPER)
          anode.scale.x = days < 120 ? 0.7 : 1
          lifeTag.set(isCap ? 'plates under solder mask' : `+ tine half gone in ${lifeText(days)}`, days < 365 ? HIGH_V : POWER)
          potTag.set(`θ ${pct(q.theta)} vol · ${q.theta <= PLANT_SOIL.dryTheta ? 'wilting' : q.theta >= PLANT_SOIL.fcTheta ? 'just watered' : 'drying out'}`, LABEL)
          const dryC = PLANT_CALS[q.cal].dry === 'air' ? 'in air' : 'dry pot'
          const wetC = PLANT_CALS[q.cal].wet === 'water' ? 'in water' : 'watered pot'
          code([
            PLANT_PROBES[q.probe].pulsed ? 'digitalWrite(PWR, HIGH); delay(10);' : `int raw = analogRead(${q.pin === 'adc1' ? 34 : 4});  // ${r.raw ?? 'fails: Wi-Fi owns ADC2'}`,
            `int pct = map(raw, ${r.dryRaw}, ${r.wetRaw}, 0, 100);  // ${dryC}, ${wetC}`,
            r.pct === null ? '// switch to GPIO 32–39 (ADC1)' : `pct = constrain(pct, 0, 100);  // ${Math.round(r.pct * 100)}`,
          ])
          sub.set(`${PLANT_PROBES[q.probe].name} · ${PLANT_CALS[q.cal].name.toLowerCase()}`, GREY)
          if (r.pct === null) event.set('analogRead() on ADC2 returns an error while Wi-Fi is on: move the probe to an ADC1 pin', HIGH_V)
          else if (!isCap && !PLANT_PROBES[q.probe].pulsed) event.set(`always-on DC through the soil eats the + tine in ${lifeText(r.life.days)}: power it only to read`, HIGH_V)
          else if (Math.abs(r.err!) >= 0.1) event.set(`shows ${pct(r.pct)} for a pot that is ${pct(r.truePct)} wet: calibrate in the pot, not in air and water`, HEAT)
          else event.set(`reads within ${pct(Math.abs(r.err!))} of the truth: the two ends match your soil`, POWER)
        }
        const blink = frac(st.t * 0.5) < (PLANT_PROBES[q.probe].pulsed ? 0.1 : 1)
        setGlow(sig, r.readable ? RING : HIGH_V, blink ? 0.7 : 0.05)
        anodeMat.emissiveIntensity = !isCap && !PLANT_PROBES[q.probe].pulsed ? 0.25 + 0.2 * Math.sin(st.t * 3) : 0
        status.set('Bench: soil probe → ESP32 ADC', LABEL)
      },
      readouts: (p) => {
        const q = mpParams(p)
        const r = plantProbe(q.probe, q.theta, q.pin, q.cal)
        return [
          { label: 'Probe output', value: `${volts(r.volts)} → ${r.raw ?? 'no reading'}`, tone: r.readable ? 'ok' : 'bad' },
          { label: 'Shown / true', value: r.pct === null ? '—' : `${pct(r.pct)} / ${pct(r.truePct)}`, tone: r.err === null ? 'bad' : toneOf(Math.abs(r.err) < 0.1, Math.abs(r.err) < 0.25) },
          { label: 'Calibration span', value: `${r.dryRaw} → ${r.wetRaw} (${r.dryRaw - r.wetRaw} counts)`, tone: 'ok' },
          { label: 'Probe life', value: lifeText(r.life.days), tone: toneOf(r.life.days > 3650, r.life.days > 365) },
        ]
      },
    }
  },
}

// --- Pump control: a 5 V pump on a low-side switch, two weeks of a pot, three ways to decide when to water. ---

const DRIVER_NAMES = namesOf(PLANT_DRIVERS)
const STRAT_NAMES = namesOf(PLANT_STRATEGIES)
const pcParams = (p: Params) => ({
  driver: pick(DRIVER_NAMES, p.driver, 'irlz') as PlantDriver,
  strategy: pick(STRAT_NAMES, p.strategy, 'until') as PlantStrategy,
  tankMl: Number(pick(PLANT_TANKS, p.tank, '1000')),
})
type PcQ = ReturnType<typeof pcParams>
const pcKey = (q: PcQ) => `${q.driver}|${q.strategy}|${q.tankMl}`
const pcRun = memoBy(pcKey, (q: PcQ) => plantRun(q))
const DAYS_H = PLANT_POT.days * 24
const LAPSE_S = 16
const SAMPLE_H = 1 / 6
const SP = { x: 4.8, y: 0.6, w: 12.6, h: 4.4 }
const TP = { x: 4.8, y: -5.6, w: 12.6, h: 2.6 }
const TANK = { x: -15.2, y: -5.6, w: 3.2, h: 3.4 }
const POT2 = { x: -8.6, y: -3.4, w: 4.6, h: 4.4 }
const dayText = (tH: number) => {
  const h = ((tH % 24) + 24) % 24
  return `day ${Math.floor(tH / 24) + 1}, ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`
}
const STRAT_CODE: Record<PlantStrategy, string[]> = {
  until: ['if (pct < 30) pumpOn();', 'if (pct > 60) pumpOff();  // probe lags the water'],
  dose: ['if (pct < 30) { pump(150 mL); soak(30 min); }', 'if (rise < 5 %) alert("tank empty?");'],
  timer: ['if (hour() == 8 && !watered) pump(100 mL);', '// same 100 mL in a heatwave'],
}

export const smartPlantMonitorPumpControl: Lesson = {
  id: 'smart-plant-monitor-pump-control',
  title: 'Pump control',
  tagline: 'A 5 V pump on a MOSFET waters the pot for two weeks: pump until it reads wet, dose and soak, or a timer, and which one notices the tank ran dry',
  formula: (p) => {
    const q = pcParams(p)
    const d = plantPumpDrive(q.driver)
    return `${d.rpm > 0 ? `V_pump = ${PLANT_RIG.supplyV} − ${volts(d.switchV)} = ${volts(d.pumpV)} → ${fixedText(d.mlPerS, 1)} mL/s at ${PLANT_RIG.liftM * 100} cm lift` : `Vgs ${GPIO_VDD} V below the gate threshold: I_D ≈ 0, the pump never turns`} · dose ${PLANT_CTRL.doseMl} mL = ${PLANT_CTRL.doseMl} / ${fixedText(plantBenchMlS(), 1)} = ${fixedText(doseSeconds(PLANT_CTRL.doseMl, plantBenchMlS() * 60), 1)} s · water reaches the probe in ~${PLANT_POT.soakS / 60} min`
  },
  legend: [
    { color: RING, label: 'Moisture the probe reads', shape: 'dot' },
    { color: GREY, label: 'True soil moisture', shape: 'dot' },
    { color: B_FIELD, label: 'Water in the tank / pumping', shape: 'dot' },
    { color: HEAT, label: 'Run out of the drain hole', shape: 'dot' },
    { color: HIGH_V, label: 'Alert / pump running dry', shape: 'dot' },
  ],
  points: [
    `A 5 V submersible pump in a tank, a tube up to the pot ${PLANT_RIG.liftM * 100} cm above. It draws ~${ampText(plantPumpDrive('irlz').amps)}: far too much for a GPIO, so a low-side N-MOSFET switches it, with a flyback diode across the motor (Components › MOSFET › Low-side switching).`,
    'The gate only gets 3.3 V. An IRLZ44N is logic-level and fully on; an IRFZ44N is specified at 10 V and this one has a 3.6 V threshold: the pump never turns (Components › MOSFET › Logic-level MOSFETs). A relay module works too, and costs ~70 mA of coil while on (Components › Relay › Driving a relay).',
    'Pump until it reads wet is a bang-bang loop with a lag (Control › Bang-bang & hysteresis): water takes minutes to soak down to the probe, so it keeps pumping long after the pot is full, and the extra pours out of the drain hole. When the tank runs dry it never reads wet, and runs the pump dry for days.',
    `Dose and soak: ${PLANT_CTRL.doseMl} mL (pump seconds from the bench-measured flow), wait ${PLANT_CTRL.soakS / 60} min, re-check. No overshoot, and if a dose doesn't raise the reading by ${pct(PLANT_CTRL.risePct)}, something is wrong: alert "tank empty or pump dead".`,
    `A timer waters ${PLANT_CTRL.timerMl} mL every morning whatever the soil says: fine on normal days, too little in the heatwave (days ${PLANT_POT.heatFrom + 1}–${PLANT_POT.heatTo}), and it never knows when the tank is empty.`,
    'Safety in firmware: a maximum pump-on time, and a float switch or the no-rise check before you leave the plant for two weeks.',
  ],
  controls: [
    { kind: 'choice', key: 'strategy', options: opts(STRAT_NAMES), initial: 'until' },
    { kind: 'choice', key: 'driver', options: opts(DRIVER_NAMES), initial: 'irlz' },
    { kind: 'choice', key: 'tank', options: opts(PLANT_TANKS), initial: '1000' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const water = new THREE.MeshStandardMaterial({ color: B_FIELD, emissive: B_FIELD, emissiveIntensity: 0.3, transparent: true, opacity: 0.8, roughness: 0.2 })
    box(scene, [TANK.w, TANK.h, 2.4], shellMat('#dfe9f5', 0.16), [TANK.x, TANK.y, 0]).castShadow = false
    const tankWater = box(scene, [TANK.w - 0.2, 1, 2.2], water, [TANK.x, TANK.y, 0])
    tankWater.castShadow = false
    const tankTag = liveLabel(scene, [TANK.x, TANK.y - TANK.h / 2 - 0.7, 0.3], { size: 0.28 })
    const pumpMat = new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.5, emissive: HIGH_V, emissiveIntensity: 0 })
    const pumpAt: V3 = [TANK.x, TANK.y - TANK.h / 2 + 0.7, 0.2]
    cylinder(scene, 0.55, 1.1, pumpMat, pumpAt, 'y', 20)
    const pot = plantPot(scene, [POT2.x, POT2.y, 0], POT2.w, POT2.h)
    pot.group.scale.setScalar(0.85)
    box(scene, [POT2.w + 1.6, 0.3, 2.6], mat('#7b5b45', { rough: 0.8 }), [POT2.x, POT2.y - POT2.h * 0.43 - 0.5, 0])
    const tubePts: V3[] = [[pumpAt[0], pumpAt[1] + 0.6, 0.3], [pumpAt[0], POT2.y + POT2.h / 2 + 1.4, 0.3], [POT2.x + 1.2, POT2.y + POT2.h / 2 + 1.4, 0.3], [POT2.x + 1.2, POT2.y + POT2.h / 2 - 0.6, 0.3]]
    const tubeMat = new THREE.MeshStandardMaterial({ color: '#dfe9f5', transparent: true, opacity: 0.5, emissive: B_FIELD, emissiveIntensity: 0 })
    for (let i = 0; i < tubePts.length - 1; i++) stretchRod(addRod(scene, tubeMat), tubePts[i], tubePts[i + 1], 0.16)
    const drips = Array.from({ length: 4 }, () => add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), water)))
    const drainMat = new THREE.MeshStandardMaterial({ color: HEAT, emissive: HEAT, emissiveIntensity: 0.6 })
    const drains = Array.from({ length: 3 }, () => add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), drainMat)))
    const drainY = POT2.y - POT2.h * 0.43
    const potTag = liveLabel(scene, [POT2.x, POT2.y - POT2.h * 0.43 - 1.2, 0.3], { size: 0.28 })
    const espAt: V3 = [-13.6, 2.4, 0]
    esp32Board(scene, espAt, 0.22)
    const fet = add(scene, new THREE.Group())
    const fetP = fetPart(fet, [-8.4, 1.4, 0], 'TO-220', { scale: 0.5 })
    const relay = add(scene, new THREE.Group())
    relayPart(relay, [-8.4, 1.6, 0], { scale: 0.24 })
    const drvTag = liveLabel(scene, [-6.8, 1.5, 0.3], { size: 0.26, align: 'left' })
    cableRun(scene, [[espAt[0] + 2, espAt[1] - 1.2, 0.8], [-8, espAt[1] - 1.2, 0.8], [-8, 1.6, 0.6]], RING, 0.06)
    const sp = scope(scene, SP.w, SP.h, { divs: [14, 4], zeroAt: 0 })
    sp.group.position.set(SP.x, SP.y, 0)
    addLabel(scene, 'Soil moisture, two weeks', [SP.x - SP.w / 2, SP.y + SP.h / 2 + 0.9, 0.3], LABEL, 0.3, 'left')
    const nowTag = liveLabel(scene, [SP.x + SP.w / 2, SP.y + SP.h / 2 + 0.9, 0.3], { size: 0.28, align: 'right' })
    addLabel(scene, '100 %', [SP.x - SP.w / 2 - 0.4, SP.y + SP.h / 2, 0.3], GREY, 0.22, 'right')
    addLabel(scene, '0', [SP.x - SP.w / 2 - 0.4, SP.y - SP.h / 2, 0.3], GREY, 0.22, 'right')
    const spY = (f: number) => (Math.min(1.05, Math.max(0, f)) - 0.5) * SP.h
    for (const d of [PLANT_POT.heatFrom, PLANT_POT.heatTo]) {
      const x = sp.xAt(d / PLANT_POT.days)
      stretchRod(addRod(sp.group, glowMat(HEAT, 0.8)), [x, -SP.h / 2, 0.1], [x, SP.h / 2, 0.1], 0.05)
    }
    addLabel(sp.group, 'heatwave', [sp.xAt((PLANT_POT.heatFrom + PLANT_POT.heatTo) / 2 / PLANT_POT.days), -SP.h / 2 + 0.4, 0.2], HEAT, 0.24)
    const lowLv = sp.level(POWER)
    lowLv.set(spY(PLANT_CTRL.lowPct))
    const wetLv = sp.level(POWER)
    const trueTr = sp.trace(GREY, { samples: 300, radius: 0.04 })
    const readTr = sp.trace(RING, { samples: 300, radius: 0.06 })
    const marks = Array.from({ length: 12 }, () => addRod(sp.group, glowMat(HIGH_V, 1)))
    const tp = scope(scene, TP.w, TP.h, { divs: [14, 2], zeroAt: 0 })
    tp.group.position.set(TP.x, TP.y, 0)
    const tankTr = tp.trace(B_FIELD, { samples: 300, radius: 0.06 })
    const drainTr = tp.trace(HEAT, { samples: 300, radius: 0.05 })
    const tankTitle = liveLabel(scene, [TP.x - TP.w / 2, TP.y + TP.h / 2 + 0.9, 0.3], { size: 0.3, align: 'left', color: LABEL })
    for (let d = 0; d < PLANT_POT.days; d += 2) addLabel(scene, `d${d + 1}`, [TP.x - TP.w / 2 + ((d + 0.5) / PLANT_POT.days) * TP.w, TP.y - TP.h / 2 - 0.6, 0.3], GREY, 0.22)
    const code = codeBlock(scene, [-17.2, -8.8, 0.3], 0.22, 3)
    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = pcParams(p)
        const R = pcRun(q)
        const key = pcKey(q)
        if (key !== st.key) {
          Object.assign(st, { key, t: 0 })
          const isRelay = q.driver === 'relay'
          fet.visible = !isRelay
          relay.visible = isRelay
          drvTag.set(PLANT_DRIVERS[q.driver].name, R.pump.rpm > 0 ? LABEL : HIGH_V)
          wetLv.group.visible = q.strategy === 'until'
          wetLv.set(spY(PLANT_CTRL.wetPct))
          tankTitle.set(`Tank (0–${q.tankMl / 1000} L) · drained`, LABEL)
        }
        st.t = (st.t + dt) % (LAPSE_S + 2)
        const tH = Math.min(1, st.t / LAPSE_S) * DAYS_H
        const s = fixedStepAt(R.samples, tH, SAMPLE_H)
        const k = Math.min(R.samples.length, Math.floor(tH / SAMPLE_H) + 1)
        const stride = Math.max(1, Math.ceil(k / 300))
        const idx: number[] = []
        for (let i = 0; i < k; i += stride) idx.push(i)
        if (idx[idx.length - 1] !== k - 1) idx.push(k - 1)
        const us = idx.map((i) => R.samples[i].t / DAYS_H)
        trueTr.points(us, idx.map((i) => spY(R.samples[i].truePct)))
        readTr.points(us, idx.map((i) => spY(R.samples[i].readPct)))
        tankTr.points(us, idx.map((i) => (R.samples[i].tankMl / q.tankMl - 0.5) * TP.h))
        drainTr.points(us, idx.map((i) => (Math.min(1, R.samples[i].drainedMl / q.tankMl) - 0.5) * TP.h), null)
        const shown = R.alerts.filter((a) => a.t <= tH).slice(0, marks.length)
        marks.forEach((m, i) => {
          const a = shown[i]
          m.visible = !!a
          if (a) {
            const x = sp.xAt(a.t / DAYS_H)
            stretchRod(m, [x, SP.h / 2 - (a.kind === 'tank' ? 1.2 : 0.6), 0.15], [x, SP.h / 2, 0.15], 0.07)
          }
        })
        const back = (h: number) => fixedStepAt(R.samples, Math.max(0, tH - h), SAMPLE_H)
        let recent = false
        for (let h = 0; h <= 4 && !recent; h += SAMPLE_H) recent = back(h).pumping
        const dry = s.tankMl <= 0
        const flowing = recent && !dry && R.pump.mlPerS > 0
        const dryRun = recent && dry && R.pump.rpm > 0
        const draining = s.drainedMl - back(3).drainedMl > 1
        tankWater.scale.y = Math.max(0.001, (s.tankMl / q.tankMl) * (TANK.h - 0.3))
        tankWater.position.y = TANK.y - TANK.h / 2 + 0.15 + tankWater.scale.y / 2
        tubeMat.emissiveIntensity = flowing ? 0.8 : 0
        pumpMat.emissiveIntensity = dryRun ? 0.5 + 0.4 * Math.sin(st.t * 12) : 0
        fetP.set(recent && R.pump.rpm > 0 ? 1 : 0)
        const end = tubePts[tubePts.length - 1]
        drips.forEach((d, i) => {
          const f = frac(st.t * 2 + i / drips.length)
          d.visible = flowing
          d.position.set(end[0], end[1] - f * 1.4, 0.3)
        })
        drains.forEach((d, i) => {
          const f = frac(st.t * 1.5 + i / drains.length)
          d.visible = draining
          d.position.set(POT2.x - 0.6, drainY - f * 0.9, 0.6)
        })
        pot.set(Math.min(1, Math.max(0, s.truePct)) * 0.8)
        pot.stem.rotation.z = s.truePct < PLANT_CTRL.alertPct ? -0.5 : 0
        potTag.set(`reads ${pct(s.readPct)}`, s.readPct < PLANT_CTRL.alertPct ? HIGH_V : RING)
        tankTag.set(`${Math.round(s.tankMl)} mL`, dry ? HIGH_V : B_FIELD)
        nowTag.set(`true ${pct(Math.max(0, s.truePct))} · read ${pct(s.readPct)}`, LABEL)
        code([...STRAT_CODE[q.strategy], `digitalWrite(PUMP, on);  // gate ${GPIO_VDD} V`])
        status.set(`${dayText(tH)} · ${dryRun ? 'pump running dry' : flowing ? 'watering' : R.pump.rpm > 0 ? 'waiting' : 'pump never starts'}`, dryRun ? HIGH_V : LABEL)
        sub.set(`14 days in ${LAPSE_S} s (${Math.round((DAYS_H * 3600) / LAPSE_S).toLocaleString('en')}× faster) · ${PLANT_STRATEGIES[q.strategy].name}`, GREY)
        const lastAlert = shown[shown.length - 1]
        if (R.pump.rpm === 0) event.set(lastAlert?.kind === 'tank' ? 'no rise after a dose: alert sent, the dead pump driver is found' : 'the gate sees 3.3 V, the FET stays off: the pot just dries out', HIGH_V)
        else if (dryRun) event.set(`tank empty since ${dayText(R.tankEmptyH!)}; the probe never reads wet, so the pump runs dry`, HIGH_V)
        else if (lastAlert && tH - lastAlert.t < 24) event.set(lastAlert.kind === 'tank' ? 'a dose raised nothing: "refill the tank" alert sent' : 'soil below 15 %: "water me" alert sent', HIGH_V)
        else if (draining) event.set('still pumping after the pot is full: the extra runs out of the drain hole', HEAT)
        else if (tH / 24 >= PLANT_POT.heatFrom && tH / 24 < PLANT_POT.heatTo) event.set('heatwave: the plant drinks 2.5× as much', HEAT)
        else event.set(`${Math.round(R.pumpedMl)} mL pumped in two weeks, ${Math.round(R.drainedMl)} mL of it out the drain`, GREY)
      },
      readouts: (p) => {
        const q = pcParams(p)
        const R = pcRun(q)
        return [
          { label: 'Pump', value: R.pump.rpm > 0 ? `${fixedText(R.pump.mlPerS, 1)} mL/s · ${ampText(R.pump.amps + R.pump.extraA)}` : 'never turns', tone: R.pump.rpm > 0 ? 'ok' : 'bad' },
          { label: 'Pumped / drained', value: `${Math.round(R.pumpedMl)} / ${Math.round(R.drainedMl)} mL`, tone: toneOf(R.drainedMl < 50, R.drainedMl < 300) },
          { label: 'Plant too dry', value: R.dryH > 0 ? hoursText(R.dryH) : 'never', tone: toneOf(R.dryH === 0, R.dryH < 24) },
          {
            label: 'Tank',
            value: R.tankEmptyH === null ? (R.tankAlertH !== null ? 'alert: no rise' : R.pumpedMl === 0 ? 'untouched' : 'lasted') : `empty day ${Math.floor(R.tankEmptyH / 24) + 1} · ${R.dryRunH > 0.1 ? `${hoursText(R.dryRunH)} dry run` : R.tankAlertH !== null ? 'alert sent' : 'no alert'}`,
            tone: R.dryRunH > 1 || R.pumpedMl === 0 ? 'bad' : R.tankEmptyH === null && R.tankAlertH === null ? 'ok' : R.tankAlertH !== null ? 'warn' : 'bad',
          },
        ]
      },
    }
  },
}
