import * as THREE from 'three/webgpu'
import {
  ACTUATOR_12V,
  AXIS,
  HomeFrame,
  HomingRoutine,
  LimitWiring,
  SCREWS,
  Screw,
  actuatorFreeMmS,
  actuatorMmS,
  actuatorStallN,
  actuatorThrustN,
  backDriveEfficiency,
  backDrives,
  fixedStepAt,
  homeErrorMm,
  homingRun,
  homingSummary,
  limitBounceTrace,
  limitPinHigh,
  mmPerMicrostep,
  screwEfficiency,
  screwLeadMm,
  screwRpm,
  screwTorqueNm,
  selfLocking,
  stepperThrustN,
  stepsPerMm,
  weightN,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, cylinder, mat, rod, STEEL } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  PIN_COLOR,
  POWER,
  RING,
  addLabel,
  codeBlock,
  cursorBar,
  esp32Board,
  glowMat,
  leadScrew,
  litWire,
  liveLabel,
  memoBy,
  microSwitch,
  microSwitchReach,
  nema17,
  scope,
  simClock,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const ALU = () => mat('#c3c8cf', { metal: 0.3, rough: 0.45 })
const pct = (f: number) => `${Math.round(f * 100)} %`
const MICRO = 16

// --- Lead screw: lead sets mm per step and the force; a fine trapezoidal thread self-locks, a ball screw doesn't. ---

const DRIVES = { t8l2: 'T8 lead 2', t8l8: 'T8 lead 8', sfu1204: 'Ball screw 1204', act: '12 V linear actuator' }
const POWERS = { on: 'Powered', off: 'Power cut' }
const LS = { x: -10.5, base: -2.6, len: 10.5, lo: 1.4, stroke: 7, mmPerU: 10, rodX: 3.4, maxV: 40, maxN: 600, hold: 1, showS: 3 }
const leadParams = (p: Params) => {
  const drive = pick(DRIVES, p.drive, 't8l8')
  const kg = n(p, 'kg')
  const v = n(p, 'speed')
  const on = pick(POWERS, p.power, 'on') === 'on'
  const F = weightN(kg)
  if (drive === 'act') {
    const s = ACTUATOR_12V.screw
    const mmS = actuatorMmS(F)
    return { drive, kg, F, on, s, act: true, mmS, maxN: actuatorStallN(), lifts: mmS > 0, drops: !on && !selfLocking(s) }
  }
  const s: Screw = SCREWS[drive]
  const maxN = stepperThrustN(s, v)
  return { drive, kg, F, on, s, act: false, mmS: v, maxN, lifts: maxN > F, drops: !on && backDrives(s, F) }
}
type LeadQ = ReturnType<typeof leadParams>
const showLead = (s: Screw) => screwLeadMm(s) * 0.5
const speedUp = (q: LeadQ) => (q.mmS > 0 ? Math.max(1, Math.ceil((LS.stroke * LS.mmPerU) / q.mmS / LS.showS)) : 1)

export const leadScrewLesson: Lesson = {
  id: 'linear-actuators-lead-screw',
  title: 'Lead screw',
  tagline: 'Turns into millimetres, torque into newtons',
  formula: (p) => {
    const q = leadParams(p)
    const L = screwLeadMm(q.s)
    if (q.act) return `F_stall = 2π·η·T·gear / lead = 2π × ${pct(screwEfficiency(q.s))} × ${ACTUATOR_12V.motorStallNm} N·m × ${ACTUATOR_12V.gear} / ${L} mm = ${actuatorStallN().toFixed(0)} N · v = ${actuatorFreeMmS().toFixed(0)} mm/s × (1 − ${q.F.toFixed(0)}/${actuatorStallN().toFixed(0)}) = ${q.mmS.toFixed(1)} mm/s`
    return `lead = ${q.s.pitchMm} mm × ${q.s.starts} start${q.s.starts > 1 ? 's' : ''} = ${L} mm → ${L}/${200 * MICRO} = ${mmPerMicrostep(L, MICRO).toFixed(5)} mm/µstep · F = 2π·η·T / lead = 2π × ${pct(screwEfficiency(q.s))} × ${screwTorqueNm(q.s, q.mmS).toFixed(2)} N·m / ${L} mm = ${q.maxN.toFixed(0)} N`
  },
  legend: [
    { color: B_FIELD, label: 'Most thrust at each speed', shape: 'dot' },
    { color: HEAT, label: 'Load (weight on the carriage)', shape: 'dot' },
    { color: POWER, label: 'Moving / holding', shape: 'dot' },
    { color: HIGH_V, label: 'Stalled / dropping', shape: 'dot' },
  ],
  points: [
    'A lead screw turns rotation into travel: one turn moves the nut by the lead, pitch × starts. A 3D printer\'s Z axis is a NEMA17 on a T8 screw: 8 mm diameter, 2 mm pitch, 4 starts, so 8 mm per turn and 3200 / 8 = 400 microsteps per mm.',
    'It is also a gearbox. The work in equals the work out, less friction: T·2π·η = F·lead, so F = 2πηT / lead. The 0.4 N·m motor pushes 185 N through a lead of 8, almost 400 N through a lead of 2, but needs 4× the rpm for the same speed, and the torque fades past a few hundred rpm.',
    'The nut slides on the flanks, so a trapezoidal screw wastes most of the torque: η = tan λ / tan(λ + φ), with λ the thread angle and φ the friction angle. When λ < φ the load can\'t turn the screw backwards at all: self-locking, so the bed stays put when the power is cut.',
    'Coarse leads and ball screws run backwards. A ball nut rolls on recirculating balls, so it is ~90 % efficient both ways: fast and stiff, but an unpowered vertical axis falls (CNCs add a brake or a counterweight). A Prusa\'s lead-8 Z sinks a little when the motors are off.',
    'A 12 V linear actuator packs a DC motor, a gearbox and a self-locking screw into a tube, with end-of-stroke switches inside. Two wires and an H-bridge: no steps to count, so the speed sags with the load and the position is only known at the ends (or from a built-in pot).',
  ],
  controls: [
    { kind: 'choice', key: 'drive', options: opts(DRIVES), initial: 't8l8' },
    { kind: 'slider', key: 'kg', label: 'Load', min: 0, max: 40, step: 1, initial: 10, format: (v) => `${v} kg` },
    { kind: 'slider', key: 'speed', label: 'Speed (stepper)', min: 2, max: LS.maxV, step: 2, initial: 10, format: (v) => `${v} mm/s` },
    { kind: 'choice', key: 'power', options: opts(POWERS), initial: 'on' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const rig = add(scene, new THREE.Group())
    const motor = nema17(rig, [LS.x, LS.base - 2.2, 0], 1.15)
    motor.group.rotation.x = -Math.PI / 2
    addLabel(rig, 'NEMA17', [LS.x + 4, LS.base - 3.2, 0.4], GREY, 0.34)
    cylinder(rig, 0.55, 1.3, ALU(), [LS.x, LS.base - 0.5, 0], 'y', 20)
    const plates = ALU()
    box(rig, [9.6, 0.5, 2.6], plates, [LS.x, LS.base - 1.95, 0])
    box(rig, [9.6, 0.5, 2.6], plates, [LS.x, LS.base + LS.len + 0.25, 0])
    for (const s of [-1, 1]) rod(rig, [LS.x + s * LS.rodX, LS.base - 1.7, 0], [LS.x + s * LS.rodX, LS.base + LS.len, 0], 0.25, STEEL())
    const screws = Object.fromEntries(
      (Object.keys(SCREWS) as (keyof typeof SCREWS)[]).map((k) => {
        const s: Screw = SCREWS[k]
        return [k, leadScrew(rig, [LS.x, LS.base, 0], LS.len, { r: 0.42, lead: showLead(s), starts: s.starts, ball: s.ball })]
      }),
    ) as Record<keyof typeof SCREWS, ReturnType<typeof leadScrew>>

    const act = add(scene, new THREE.Group())
    act.visible = false
    const tubeTop = LS.base + LS.lo - 0.6
    const actBody = mat('#3a3d44', { rough: 0.5 })
    cylinder(act, 0.8, tubeTop + 7.6, actBody, [LS.x, (tubeTop - 7.6) / 2, 0], 'y', 28)
    cylinder(act, 0.7, 5, actBody, [LS.x + 1.75, -5.2, 0], 'y', 24)
    box(act, [3.6, 1.6, 1.8], actBody, [LS.x + 0.9, -7.6, 0])
    addLabel(act, '12 V', [LS.x + 1.75, -4.6, 0.8], GREY, 0.36)
    const actRod = cylinder(act, 0.35, 1, STEEL(), [LS.x, 0, 0], 'y', 16)

    const carriage = add(scene, new THREE.Group())
    box(carriage, [2 * LS.rodX + 1.2, 0.9, 2], ALU(), [LS.x, 0.75, 0])
    const bearings = add(carriage, new THREE.Group())
    for (const s of [-1, 1]) cylinder(bearings, 0.55, 1.4, mat('#5d636c', { metal: 0.3, rough: 0.4 }), [LS.x + s * LS.rodX, 0.75, 0], 'y', 16)
    box(carriage, [6, 0.4, 3], ALU(), [LS.x + LS.rodX + 3.4, 1, 0])
    const loadBox = box(carriage, [1, 1, 1], mat('#5d636c', { metal: 0.3, rough: 0.5 }), [LS.x + LS.rodX + 3.8, 1.7, 0])
    const kgTag = liveLabel(carriage, [LS.x + LS.rodX + 3.8, 4.2, 0.4], { size: 0.4 })
    const status = liveLabel(scene, [LS.x, LS.base + LS.len + 3.4, 0.4], { size: 0.42 })
    const leadTag = liveLabel(scene, [LS.x, LS.base + LS.len + 2.2, 0.4], { size: 0.36 })
    addLabel(rig, `threads drawn 5× coarse · stroke ${LS.stroke * LS.mmPerU} mm`, [LS.x, LS.base + LS.len + 1.3, 0.4], GREY, 0.3)

    const plot = scope(scene, 11, 4.6, { divs: [8, 6], zeroAt: 0 })
    plot.group.position.set(6.6, 1.4, 0)
    const yF = (f: number) => (f / LS.maxN - 0.5) * plot.height
    const curve = plot.trace(B_FIELD, { samples: 120, radius: 0.06 })
    const loadLine = plot.level(HEAT)
    const dot = add(plot.group, new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), glowMat(POWER, 1.2)))
    ticks(plot, [0, 10, 20, 30, 40].map((v): [number, string] => [v / LS.maxV, `${v}`]), [0, 200, 400, 600].map((f): [number, string] => [f / LS.maxN, `${f}`]), 0.36)
    addLabel(scene, 'thrust 0…600 N vs speed 0…40 mm/s', [6.6, -2, 0.3], GREY, 0.32)
    const result = liveLabel(scene, [6.6, -3.3, 0.3], { size: 0.4 })
    const code = codeBlock(scene, [-2.4, -4.8, 0.3], 0.36)

    const st = { t: 0, key: '', y: 0 }
    return {
      scene,
      view: { center: [-2.2, -0.2, 0], radius: 64, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = leadParams(p)
        const key = `${q.drive}|${q.kg}|${q.mmS}|${q.on}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          curve.draw((u) => yF(q.act ? actuatorThrustN(u * LS.maxV) : stepperThrustN(q.s, u * LS.maxV)), null)
          loadLine.set(yF(q.F))
          dot.position.set(plot.xAt(Math.min(1, q.mmS / LS.maxV)), yF(Math.min(LS.maxN, q.F)), 0.3)
          dot.visible = q.on
          ;(dot.material as THREE.MeshStandardMaterial).emissive.set(q.lifts ? POWER : HIGH_V)
          const L = screwLeadMm(q.s)
          leadTag.set(q.act ? `motor + ${ACTUATOR_12V.gear}:1 gears + ${q.s.name} screw, self-locking` : `${q.s.name}: ${L} mm/rev · ${mmPerMicrostep(L, MICRO).toFixed(5)} mm/µstep`, LABEL)
          const spm = stepsPerMm(L, MICRO)
          code(
            q.act
              ? q.on
                ? ['digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);  // extend', `// no steps: ${q.mmS.toFixed(1)} mm/s at ${q.F.toFixed(0)} N`, '// stops at its own end switch']
                : ['digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);  // off', '// self-locking screw: the rod holds']
              : q.on
                ? [`const float STEPS_PER_MM = ${200 * MICRO} / ${L}.0;  // ${spm}`, `stepper.setMaxSpeed(${q.mmS} * STEPS_PER_MM);  // ${screwRpm(q.mmS, L).toFixed(0)} rpm`, `stepper.moveTo(${LS.stroke * LS.mmPerU} * STEPS_PER_MM);  // Z up`]
                : ['digitalWrite(EN_PIN, HIGH);  // driver off, coils dead', q.drops ? `// ${q.F.toFixed(0)} N back-drives the screw: Z drops` : `// detent + friction hold ${q.F.toFixed(0)} N`],
          )
          result.set(
            q.on
              ? q.lifts
                ? `Lifts ${q.F.toFixed(0)} N at ${q.mmS.toFixed(1)} mm/s, ${q.act ? `stall at ${q.maxN.toFixed(0)} N` : `margin ${(q.maxN - q.F).toFixed(0)} N`}`
                : q.act
                  ? `Stalled: ${q.F.toFixed(0)} N ≥ ${q.maxN.toFixed(0)} N stall force`
                  : `Skips steps: needs ${q.F.toFixed(0)} N, only ${q.maxN.toFixed(0)} N at ${q.mmS} mm/s`
              : q.drops
                ? 'Power cut: the load spins the screw back, the axis drops'
                : selfLocking(q.s)
                  ? 'Power cut: self-locking, the nut holds'
                  : 'Power cut: detent torque just holds it',
            q.on ? (q.lifts ? POWER : HIGH_V) : q.drops ? HIGH_V : POWER,
          )
        }
        st.t += dt
        const k = speedUp(q)
        const move = (LS.stroke * LS.mmPerU) / Math.max(q.mmS, 1e-6) / k
        let y = LS.lo
        let buzz = 0
        if (!q.on) {
          const fall = Math.max(0, st.t - LS.hold)
          y = q.drops ? Math.max(LS.lo, LS.lo + LS.stroke - 3 * fall * fall) : LS.lo + LS.stroke
          if (st.t > LS.hold + 1.6 + 2 * LS.hold) st.t = 0
        } else if (!q.lifts) {
          buzz = q.act ? 0 : 0.04 * Math.sin(st.t * 70)
        } else {
          const cyc = 2 * move + 2 * LS.hold
          const t = st.t % cyc
          const u = t < move ? t / move : t < move + LS.hold ? 1 : t < 2 * move + LS.hold ? 1 - (t - move - LS.hold) / move : 0
          y = LS.lo + u * LS.stroke
        }
        st.y = y
        const drawn = showLead(q.s)
        for (const [name, sc] of Object.entries(screws)) {
          sc.group.visible = name === q.drive
          if (name === q.drive) {
            sc.set(y + buzz)
            sc.spin.rotation.y += (buzz * 2 * Math.PI) / drawn
          }
        }
        rig.visible = !q.act
        bearings.visible = !q.act
        act.visible = q.act
        carriage.position.y = LS.base + y + buzz - 0.75
        const rodLen = LS.base + y - tubeTop
        actRod.scale.y = rodLen
        actRod.position.y = tubeTop + rodLen / 2
        motor.set(((y - LS.lo) / drawn) * 2 * Math.PI, 0.7, 0.7)
        loadBox.scale.set(1.4 + q.kg * 0.03, 0.4 + q.kg * 0.06, 1.6)
        loadBox.position.y = 1.2 + loadBox.scale.y / 2
        kgTag.group.position.y = 1.7 + loadBox.scale.y
        kgTag.set(`${q.kg} kg = ${q.F.toFixed(0)} N`, LABEL)
        status.set(!q.on ? (q.drops ? 'unpowered: dropping' : 'unpowered: holding') : q.lifts ? '' : q.act ? 'stalled' : 'buzzing, skipping steps', !q.on && !q.drops ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const q = leadParams(p)
        const L = screwLeadMm(q.s)
        const k = speedUp(q)
        return [
          { label: 'Lead', value: q.act ? `${L} mm, ${ACTUATOR_12V.gear}:1 gear` : `${L} mm · ${stepsPerMm(L, MICRO)} µsteps/mm` },
          { label: 'Screw speed', value: q.on ? `${screwRpm(q.mmS, L).toFixed(0)} rpm${k > 1 ? ` (shown ${k}× faster)` : ''}` : 'unpowered' },
          { label: 'Thrust', value: `${q.F.toFixed(0)} / ${q.maxN.toFixed(0)} N`, tone: q.lifts ? (q.F > 0.8 * q.maxN ? 'warn' : 'ok') : 'bad' },
          { label: 'Efficiency', value: `${pct(screwEfficiency(q.s))} fwd, ${pct(backDriveEfficiency(q.s))} back`, tone: q.drops ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Limit switches: home to a microswitch (fast, back off, slow), NO vs NC wiring, bounce, soft limits, crash. ---

const ROUTINES = { two: 'Two-pass homing', one: 'One fast pass', none: 'No limit switch' }
const WIRINGS = { no: 'NO to GND', nc: 'NC to GND' }
const WIRES = { ok: 'Wire OK', broken: 'Wire broken' }
const PHASES = { fast: 'Seek fast', backoff: 'Back off', slow: 'Creep back', jog: 'Jog', done: 'Done', alarm: 'ALARM' }
const phaseText = (f: HomeFrame, jammed: boolean) => (f.crashed ? 'CRASH: grinding, skipping steps' : f.phase === 'done' && jammed ? 'Done? Jammed against the frame' : PHASES[f.phase])
const LM = { x0: -12.6, k: 0.115, y: 3.4, cw: 2, swK: 0.18, zoomS: 6e-3, sx: 7.6, sw: 9 }
const limitParams = (p: Params) => ({
  routine: pick(ROUTINES, p.routine, 'two') as HomingRoutine,
  wiring: pick(WIRINGS, p.wiring, 'nc') as LimitWiring,
  broken: pick(WIRES, p.wire, 'ok') === 'broken',
  holdS: n(p, 'hold') / 1000,
})
type LimitQ = ReturnType<typeof limitParams>
const limitKey = (q: LimitQ) => `${q.routine}|${q.wiring}|${q.broken}|${q.holdS}`
const homeMemo = memoBy(limitKey, (q: LimitQ) => homingRun(q.routine, q.wiring, q.broken, q.holdS))
const bounceMemo = memoBy((q: LimitQ) => `${q.wiring}|${q.holdS}|${q.broken}`, (q: LimitQ) => limitBounceTrace(q.wiring, q.holdS, LM.zoomS, q.broken))
const sx = (mm: number) => LM.x0 + mm * LM.k
const END_L = sx(-AXIS.endStopMm)
const END_R = sx(AXIS.travelMm + AXIS.endStopMm) + LM.cw

function homingCode(q: LimitQ) {
  const read = q.holdS > 0 ? `debounced(LIMIT, ${q.holdS * 1000} ms)` : 'digitalRead(LIMIT)'
  const hit = `bool hit() { return ${read} == ${q.wiring === 'no' ? 'LOW' : 'HIGH'}; }  // ${q.wiring.toUpperCase()}, pull-up`
  if (q.routine === 'none') return ['pos = 0;  // no switch: trust the power-on spot', `moveTo(min(${AXIS.jogMm}, X_MAX));  // soft limit ${AXIS.travelMm} mm`, '// ...relative to a wrong zero']
  if (q.routine === 'one') return [hit, `while (!hit()) step(-1, ${AXIS.fastMmS} mm/s);`, 'pos = 0;  // zeroed at full speed', `moveTo(min(${AXIS.jogMm}, X_MAX));  // soft limit`]
  return [hit, `while (!hit()) step(-1, ${AXIS.fastMmS} mm/s);  move(+${AXIS.backoffMm});`, `while (!hit()) step(-1, ${AXIS.slowMmS} mm/s);  pos = 0;`, `moveTo(min(${AXIS.jogMm}, X_MAX));  // soft limit`]
}

export const limitSwitches: Lesson = {
  id: 'linear-actuators-limit-switches',
  title: 'Limit switches',
  tagline: 'Find zero, then never cross the ends',
  formula: (p) => {
    const q = limitParams(p)
    return `zero error ≤ v·(t_loop + t_debounce): fast ${AXIS.fastMmS} mm/s → ${homeErrorMm(AXIS.fastMmS, q.holdS).toFixed(3)} mm, slow ${AXIS.slowMmS} mm/s → ${homeErrorMm(AXIS.slowMmS, q.holdS).toFixed(4)} mm · pin = ${q.wiring === 'no' ? 'LOW when pressed' : 'HIGH when pressed or wire broken'}`
  },
  legend: [
    { color: POWER, label: 'Real position / debounced pin', shape: 'dot' },
    { color: RING, label: 'Where the firmware thinks it is', shape: 'dot' },
    { color: PIN_COLOR, label: 'Raw pin (bounces)', shape: 'dot' },
    { color: HIGH_V, label: 'Hard stop · crash · alarm', shape: 'dot' },
  ],
  points: [
    'A stepper counts steps from wherever it woke up, so first it homes: drive toward a microswitch until it clicks, back off a few mm, creep back slowly and call that point zero. The fast pass finds it quickly; the slow pass trips it at 1/10 the speed, so the 1 ms loop and the debounce wait add 10× less error.',
    'A microswitch has COM, NO (normally open) and NC (normally closed). With INPUT_PULLUP and COM to GND, NO reads LOW when pressed; NC reads HIGH when pressed. NC is the safe choice: a broken wire or unplugged connector also reads HIGH, "hit", so the machine refuses to move instead of driving on blind.',
    'The contacts bounce for a millisecond or two as they make or break. An interrupt on CHANGE sees a burst of edges; accept a new level only once it has held a few ms (or count the first edge and ignore the rest), and the homing state machine sees one clean click.',
    'Soft limits: once homed, the firmware clamps every target to 0…X_MAX, so a typo of 130 mm stops at 100. Hard limits: switches at the ends that cut motion (often via an interrupt or the driver\'s enable) if something gets there anyway: a missed-step drift, a bad G-code.',
    'Without a switch the zero is wherever the axis happened to be at power-on. The soft limit then clamps around the wrong zero, and the carriage drives into the frame: the stepper grinds and skips (open loop, it never knows), belts jump, the screw jams.',
  ],
  controls: [
    { kind: 'choice', key: 'routine', options: opts(ROUTINES), initial: 'two' },
    { kind: 'choice', key: 'wiring', options: opts(WIRINGS), initial: 'nc' },
    { kind: 'choice', key: 'wire', options: opts(WIRES), initial: 'ok' },
    { kind: 'slider', key: 'hold', label: 'Debounce', min: 0, max: 3, step: 0.5, initial: 0, format: (v) => (v ? `${v} ms` : 'off') },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const motorX = END_L - 2.4
    const motor = nema17(scene, [motorX, LM.y, 0], 1)
    motor.group.rotation.y = Math.PI / 2
    addLabel(scene, 'NEMA17', [motorX - 0.8, LM.y + 2.6, 0.4], GREY, 0.32)
    cylinder(scene, 0.5, 1, ALU(), [motorX + 1.4, LM.y, 0], 'x', 20)
    const screw = leadScrew(scene, [END_L - 0.6, LM.y, 0], END_R - END_L + 0.9, { r: 0.36, lead: 1, starts: 1 })
    screw.group.rotation.z = -Math.PI / 2
    const frame = mat('#3a3d44', { rough: 0.55 })
    box(scene, [0.6, 4.4, 2.6], frame, [END_L - 0.3, LM.y - 0.4, 0])
    box(scene, [0.6, 4.4, 2.6], frame, [END_R + 0.3, LM.y - 0.4, 0])
    box(scene, [END_R - END_L + 1.2, 0.5, 2.6], frame, [(END_R + END_L) / 2, LM.y - 2.85, 0])
    rod(scene, [END_L, LM.y + 1.4, -0.6], [END_R, LM.y + 1.4, -0.6], 0.18, STEEL())
    addLabel(scene, 'hard stop', [END_L - 0.3, LM.y + 2.4, 0.4], HIGH_V, 0.28)
    addLabel(scene, 'hard stop', [END_R + 0.3, LM.y + 2.4, 0.4], HIGH_V, 0.28)

    const carriage = add(scene, new THREE.Group())
    box(carriage, [LM.cw, 2.6, 2], ALU(), [LM.cw / 2, 0.4, 0])
    box(carriage, [0.3, 2.4, 1.8], mat('#d9b24a', { metal: 0.3, rough: 0.4 }), [0.15, -1.7, 1])
    const crashGlow = box(carriage, [LM.cw + 0.3, 2.9, 2.3], glowMat(HIGH_V, 0.8), [LM.cw / 2, 0.4, 0])
    ;(crashGlow.material as THREE.MeshStandardMaterial).transparent = true
    ;(crashGlow.material as THREE.MeshStandardMaterial).opacity = 0.35

    const k = LM.swK
    const [reachX, reachY] = microSwitchReach(k)
    const sw = microSwitch(scene, [LM.x0 + 0.33 - reachX, LM.y - 2.5 - reachY, 1.4], k)
    const esp = esp32Board(scene, [-11, -7.4, 0], 0.3)
    const gnd = esp(-6, true)
    const gpio = esp(-3, true)
    const pathTo = (pin: V3, from: V3, y: number): V3[] => [from, [from[0], y, from[2]], [pin[0], y, pin[2]], pin]
    const comWire = add(scene, new THREE.Group())
    wire(comWire, pathTo(gnd, sw.pins.com, -4.2), 0.06)
    const sig = Object.fromEntries(
      (['no', 'nc'] as const).map((w) => {
        const pts = pathTo(gpio, sw.pins[w], -4.8)
        const group = add(scene, new THREE.Group())
        const mid = (pts[1][0] + pts[2][0]) / 2
        wire(group, [pts[0], pts[1], [mid + 0.35, pts[1][1], pts[1][2]]], 0.06)
        wire(group, [[mid - 0.35, pts[2][1], pts[2][2]], pts[2], pts[3]], 0.06)
        const bridge = add(group, new THREE.Group())
        wire(bridge, [[mid + 0.35, pts[1][1], pts[1][2]], [mid - 0.35, pts[2][1], pts[2][2]]], 0.06)
        return [w, { group, bridge, mid, glow: litWire(group, pts, 0.11) }]
      }),
    ) as Record<LimitWiring, { group: THREE.Group; bridge: THREE.Group; mid: number; glow: ReturnType<typeof litWire> }>
    const breakTag = liveLabel(scene, [0, -4.3, 1.6], { size: 0.3 })
    addLabel(scene, 'GND', [gnd[0] - 0.8, -5.2, 0.4], GREY, 0.28)
    const pinTag = liveLabel(scene, [gpio[0] + 0.6, -5.4, 0.4], { size: 0.32, align: 'left' })
    const phaseTag = liveLabel(scene, [(END_L + END_R) / 2, LM.y + 3.6, 0.4], { size: 0.44 })
    const posTag = liveLabel(scene, [(END_L + END_R) / 2, LM.y + 2.6, 0.4], { size: 0.34 })

    const pos = scope(scene, LM.sw, 4.2, { divs: [10, 4], zeroAt: 0 })
    pos.group.position.set(LM.sx, 3.6, 0)
    const yX = (mm: number) => ((mm + 10) / 120 - 0.5) * pos.height
    const N = 500
    const tReal = pos.trace(POWER, { samples: N, radius: 0.06 })
    const tBel = pos.trace(RING, { samples: N, radius: 0.05 })
    const cursor = cursorBar(pos, LABEL)
    pos.level(HIGH_V).set(yX(-AXIS.endStopMm))
    pos.level(HIGH_V).set(yX(AXIS.travelMm + AXIS.endStopMm))
    pos.level(HEAT).set(yX(AXIS.travelMm))
    ticks(pos, [], [0, 50, 100].map((m): [number, string] => [(m + 10) / 120, `${m}`]), 0.34)
    addLabel(scene, `position, mm · 0…${AXIS.seconds} s, real time`, [LM.sx, 0.9, 0.3], GREY, 0.3)

    const zoom = scope(scene, LM.sw, 3, { divs: [6, 2] })
    zoom.group.position.set(LM.sx, -2.4, 0)
    const tRaw = zoom.trace(PIN_COLOR, { samples: 300, radius: 0.05 })
    const tDb = zoom.trace(POWER, { samples: 300, radius: 0.06 })
    addLabel(scene, `pin at the click, 0…${LM.zoomS * 1000} ms (raw, debounced)`, [LM.sx, -4.4, 0.3], GREY, 0.3)
    const edgeTag = liveLabel(scene, [LM.sx, -5.3, 0.3], { size: 0.34 })
    const code = codeBlock(scene, [-6.6, -7.8, 0.3], 0.34, 4)
    const result = liveLabel(scene, [LM.sx - 1, -6.6, 0.3], { size: 0.38 })

    const clock = simClock(0.001, 2.5)
    const st = { t: 0, key: '', jammed: false }
    return {
      scene,
      view: { center: [-3.4, -1.2, 0], radius: 60, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = limitParams(p)
        const run = homeMemo(q)
        const key = limitKey(q)
        const t = clock(dt, key, AXIS.seconds * 1000) / 1000
        st.t = t
        if (key !== st.key) {
          st.key = key
          const every = Math.ceil(run.length / N)
          const pts = run.filter((_, i) => i % every === 0)
          tReal.points(pts.map((f) => f.t / AXIS.seconds), pts.map((f) => yX(f.x)))
          const bel = run.filter((f, i) => f.believed !== null && i % every === 0)
          tBel.group.visible = bel.length > 0
          if (bel.length) tBel.points(bel.map((f) => f.t / AXIS.seconds), bel.map((f) => yX(f.believed ?? 0)))
          const b = bounceMemo(q)
          const lvl = (h: boolean, o: number) => (h ? 0.32 : -0.32) * zoom.height + o
          const ev = b.out.filter((_, i) => i % 2 === 0)
          tRaw.points(ev.map((f) => f.t / LM.zoomS), ev.map((f) => lvl(f.raw, 0.08)))
          tDb.points(ev.map((f) => f.t / LM.zoomS), ev.map((f) => lvl(f.stable, -0.08)))
          edgeTag.set(q.routine === 'none' ? '' : q.broken ? 'broken wire: pull-up holds HIGH, no click seen' : `${b.rawEdges} raw edges → ${b.stableEdges} after debounce${q.holdS ? `, settled at ${msText(b.settleS)}` : ''}`, q.broken ? HIGH_V : b.stableEdges > 1 ? HEAT : POWER)
          code(homingCode(q))
          const s = homingSummary(run)
          st.jammed = s.crashAt !== null
          result.set(
            s.alarmAt !== null && s.crashAt === null
              ? 'Alarm at once: switch reads "hit", nothing moves'
              : s.crashAt !== null
                ? s.zeroMm === null
                  ? `Crash at ${msText(s.crashAt)}: never saw the switch`
                  : `Crash at ${msText(s.crashAt)}: zero was ${s.zeroMm.toFixed(0)} mm off`
                : `Homed: zero within ${Math.abs(s.zeroMm ?? 0).toFixed(4)} mm, jog stopped at ${AXIS.travelMm} mm`,
            s.crashAt !== null ? HIGH_V : s.alarmAt !== null ? HEAT : POWER,
          )
          for (const w of ['no', 'nc'] as const) {
            sig[w].group.visible = q.routine !== 'none' && w === q.wiring
            sig[w].bridge.visible = !q.broken
          }
          breakTag.group.position.x = sig[q.wiring].mid
          breakTag.set(q.broken && q.routine !== 'none' ? 'broken' : '', HIGH_V)
        }
        sw.group.visible = comWire.visible = tRaw.group.visible = tDb.group.visible = q.routine !== 'none'
        cursor(t / AXIS.seconds)
        const f: HomeFrame = fixedStepAt(run, t, AXIS.pollS)
        const xs = sx(f.x)
        carriage.position.set(xs, LM.y, 0)
        screw.set(xs - END_L + 0.6)
        motor.set(-screw.spin.rotation.y, 0.7, 0.7)
        crashGlow.visible = f.crashed && Math.sin(t * 40) > 0
        if (f.crashed) carriage.position.x += 0.05 * Math.sin(t * 90)
        const travel = sw.group.position.x + reachX - xs
        const press = Math.max(0, Math.min(1, travel / 0.6))
        sw.set(press, f.pressed ? 'no' : press > 0.55 ? null : 'nc')
        const high = limitPinHigh(q.wiring, f.pressed, q.broken)
        sig[q.wiring].glow.set(high ? 0.8 : 0.1, new THREE.Color(PIN_COLOR))
        pinTag.set(q.routine === 'none' ? '' : `GPIO ${high ? 'HIGH' : 'LOW'}${f.hit ? ': hit' : ''}`, f.hit ? HEAT : LABEL)
        const jammed = st.jammed
        phaseTag.set(phaseText(f, jammed), f.crashed || f.phase === 'alarm' || (jammed && f.phase === 'done') ? HIGH_V : f.phase === 'done' ? POWER : RING)
        posTag.set(`real ${f.x.toFixed(1)} mm · thinks ${f.believed === null ? '?' : `${f.believed.toFixed(1)} mm`}`, LABEL)
      },
      readouts: (p) => {
        const q = limitParams(p)
        const run = homeMemo(q)
        const f = fixedStepAt(run, st.t, AXIS.pollS)
        const s = homingSummary(run)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (real time)` },
          { label: 'Phase', value: f.crashed ? 'Crashed' : f.phase === 'done' && s.crashAt !== null ? 'Jammed' : PHASES[f.phase], tone: f.crashed || f.phase === 'alarm' || s.crashAt !== null ? 'bad' : 'ok' },
          { label: 'Pin', value: q.routine === 'none' ? '—' : `${limitPinHigh(q.wiring, f.pressed, q.broken) ? 'HIGH' : 'LOW'}${f.hit ? ' (hit)' : ''}` },
          { label: 'Zero error', value: s.zeroMm === null ? '—' : `${s.zeroMm.toFixed(s.zeroMm > 1 ? 0 : 4)} mm`, tone: s.zeroMm === null || Math.abs(s.zeroMm) > 0.05 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
