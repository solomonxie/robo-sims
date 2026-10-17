import * as THREE from 'three/webgpu'
import {
  ARM_JOINT,
  E_BOX,
  JointDrive,
  PLA_CREEP_C,
  SINK,
  SINK_AIR,
  SINK_MOUNTS,
  SINK_ORIENT,
  SinkAir,
  SinkMount,
  SinkOrient,
  TAB,
  fixedStepAt,
  heatsinkView,
  jointHeat,
} from '../../core/physics'
import { amps, celsiusText, fixedText, mmTenths, newtonsText, nmText, pct, thetaText, watts } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  WIDE_RIGHT,
  WIDE_VIEW,
  addLabel,
  boxFan,
  countBars,
  cursorBar,
  fetPart,
  finnedSink,
  forceArrow,
  glide,
  glowDot,
  glowMat,
  heatTint,
  heatWaves,
  lapseClock,
  liveLabel,
  memoBy,
  nema17,
  plotY,
  sg90Servo,
  shellMat,
  statusHeader,
  textRows,
  thermalLadder,
  titledScope,
  toneColor,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const AMB = 25
const TJ_MAX = 150
const minText = (s: number) => `${Math.round(s / 60)} min`

// --- Heatsinks: a TO-220 MOSFET on a 40 mm plate-fin sink; fin count, orientation, airflow, mounting, enclosure. ---

const HS = { at: [-10.4, -3.6, 0] as V3, k: 0.2, ladder: [3.2, -3.6, 0] as V3, box: [10.5, 10.5, 7] as V3, plot: { y: -10.2, h: 5 } }
const hsParams = (p: Params) => ({
  watts: n(p, 'watts'),
  fins: n(p, 'fins'),
  orient: pick(SINK_ORIENT, p.orient, 'vertical') as SinkOrient,
  air: pick(SINK_AIR, p.air, 'open') as SinkAir,
  mount: pick(SINK_MOUNTS, p.mount, 'paste') as SinkMount,
})
const hsRun = memoBy((p: Params) => `${p.watts} ${p.fins} ${p.orient} ${p.air} ${p.mount}`, (p: Params) => {
  const q = hsParams(p)
  return { q, V: heatsinkView({ ...q, ambC: AMB }) }
})
const tjTone = (t: number) => toneOf(t < 110, t < TJ_MAX)
const ORIENT_ROT: Record<SinkOrient, V3> = { vertical: [0, 0, 0], up: [-Math.PI / 2, 0, 0], sideways: [0, 0, Math.PI / 2] }

export const thermalDesignHeatsinks: Lesson = {
  id: 'thermal-design-heatsinks',
  title: 'Heatsinks',
  tagline: 'Pick the fins, the joint and the air around a hot MOSFET',
  formula: (p) => {
    const { q, V } = hsRun(p)
    const [jc, cs, sa] = V.thetas
    return `Tj = T_air + P·(θjc + θcs + θsa) = ${celsiusText(V.airC, 1)} + ${watts(q.watts)} × (${fixedText(jc, 1)} + ${fixedText(cs, 2)} + ${fixedText(sa, 2)}) °C/W = ${celsiusText(V.tj)} · θsa = 1/(h·(η·A_fins + A_base) + G_rad), h = ${fixedText(V.h, 1)} W/(m²·K), fin efficiency η = ${pct(V.eta)}, gap ${mmTenths(V.gap)} · box air +${celsiusText(V.box.rise, 1)} (typical)`
  },
  legend: [
    { color: HEAT, label: 'Heat path: column height = temperature', shape: 'dot' },
    { color: RING, label: 'Chosen fin count', shape: 'dot' },
    { color: POWER, label: 'Best fin count for this air', shape: 'dot' },
    { color: HIGH_V, label: `${TJ_MAX} °C junction limit`, shape: 'dot' },
  ],
  points: [
    'A motor-driver MOSFET or regulator makes watts of heat in a die the size of a fingernail. The heat path is a chain of thermal resistances, junction → case → sink → air, as in Waves, light & heat › Heat transfer › Thermal resistance. Designing the sink means shrinking the last links: θcs (the joint) and θsa (the sink).',
    'More fins means more area, but in still air the warm air rises slowly between them: below about 5 mm (typical, for a 40 mm tall sink) the boundary layers of neighbouring fins meet and choke the channel, so θsa gets worse again. There is a best spacing, and catalogue sinks for natural convection have few, wide-spaced fins.',
    'Orientation matters for natural convection: fins vertical let air rise straight up the channels (a chimney); base flat with fins up is a bit worse; fins horizontal trap the warm air and lose about half. Any airflow, from a fan or simply the robot driving at 1 m/s, sweeps the channels, cuts θsa several times and makes denser fins pay off.',
    'The joint: a dry metal-to-metal contact touches only at high spots, so air fills the rest. A smear of paste under a firm screw is about 0.2 °C/W over a TO-220 tab, a 1 mm silicone pad about 3 (but it insulates electrically), a dry joint 8, a loose one over 30. Paste thin, screw tight, insulating washer if the tab is live.',
    'A sink only moves heat into the air next to it. Shut it in a printed box and the box air heats up until the walls pass all the watts (here every board adds heat too): +40 °C or more is common. Vents low and high let a chimney flow through; a small fan both changes the box air and blows over the fins. Then check the chain again from the room temperature.',
  ],
  controls: [
    { kind: 'slider', key: 'watts', label: 'MOSFET heat', min: 1, max: 15, step: 0.5, initial: 6, format: (v) => `${v} W` },
    { kind: 'slider', key: 'fins', label: 'Fin count', min: 2, max: 24, step: 1, initial: 14, format: (v) => `${v} fins` },
    { kind: 'choice', key: 'orient', options: opts(namesOf(SINK_ORIENT)), initial: 'vertical' },
    { kind: 'choice', key: 'air', options: opts(namesOf(SINK_AIR)), initial: 'open' },
    { kind: 'choice', key: 'mount', options: opts(namesOf(SINK_MOUNTS)), initial: 'paste' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const asm = add(scene, new THREE.Group(), HS.at)
    asm.rotation.set(0.6, -0.35, 0)
    const holder = add(asm, new THREE.Group())
    const sink = finnedSink(holder, [0, 0, 0], SINK, HS.k * 1000)
    const fet = fetPart(holder, [0, -1.2, -SINK.baseT * HS.k * 1000 - 0.45], 'TO-220', { scale: 1.1 })
    fet.group.rotation.y = Math.PI
    const waves = heatWaves(scene, 6, { count: 6, rise: 2.2 })
    waves.group.position.set(HS.at[0], HS.at[1] + 3.8, 0)
    const [bw, bh, bd] = HS.box
    const enclosure = add(asm, new THREE.Group())
    box(enclosure, [bw, bh, bd], shellMat('#c9d2e0', 0.07, 0.5), [0, 0, 1])
    const vents = add(enclosure, new THREE.Group())
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) box(vents, [0.35, 0.12, bd * 0.7], glowMat(LOW_V, 0.6), [-1.6 + i * 1.05, s * (bh / 2 + 0.02), 1])
    const fan = boxFan(enclosure, [0, -bh / 2 + 1.6, 1], 3)
    fan.group.rotation.x = Math.PI / 2
    const windArrows = add(asm, new THREE.Group())
    for (let i = -1; i <= 1; i++) box(windArrows, [0.12, 2.2, 0.12], glowMat(LOW_V, 0.8), [i * 2.6, -6.3, 2.4])
    const boxTag = liveLabel(scene, [HS.at[0], HS.at[1] - 6.9, 0.6], { size: 0.3 })

    const ladder = thermalLadder(scene, HS.ladder, ['junction', 'case', 'sink', 'box air', 'room'], ['θjc', 'mount', 'θsa', 'box'], { w: 10.8, h: 3, maxC: 200, limitC: TJ_MAX })
    const P = WIDE_RIGHT
    const plot = titledScope(scene, HS.plot.y, HS.plot.h, 'θsa vs fin count', LABEL, 0, P.x, P.w)
    const T_MAX = 25
    const py = plotY(0, T_MAX, HS.plot.h)
    const curve = plot.s.trace(HEAT, { samples: 23, radius: 0.07 })
    const marker = glowDot(plot.s.group, 0.28, RING)
    const best = glowDot(plot.s.group, 0.2, POWER)
    const cursor = cursorBar(plot.s, RING, 0.06)
    plot.lo.set('2 fins')
    plot.hi.set('24 fins')
    addLabel(plot.s.group, `${T_MAX} °C/W`, [P.w / 2 - 0.2, HS.plot.h / 2 - 0.4, 0.4], GREY, 0.22, 'right')
    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    const st = { wind: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = hsRun(p)
        const A = SINK_AIR[q.air]
        sink.set(q.fins)
        holder.rotation.set(...ORIENT_ROT[q.orient])
        const sinkC = V.temps[2]
        sink.heat((sinkC - AMB) / 100)
        fet.set(0.6, (V.tj - 70) / 100)
        waves.step(dt, ((sinkC - V.airC) / 60) * (A.v > 0 ? 0.4 : 1))
        enclosure.visible = A.boxed
        vents.visible = A.vent > 0
        fan.group.visible = A.fanQ > 0
        fan.spin(dt, 18)
        windArrows.visible = A.v > 0
        st.wind = (st.wind + dt * 2.5 * A.v) % 2.4
        windArrows.position.y = st.wind
        boxTag.set(A.boxed ? `${A.name}: air inside ${celsiusText(V.airC)}, box drawn not to scale` : `${A.name}, ${AMB} °C room`, A.boxed && V.box.rise > 20 ? HEAT : GREY)

        const P_all = q.watts + (A.boxed ? E_BOX.otherW : 0)
        ladder.set(V.temps, [...V.thetas, A.boxed ? V.box.rise / P_all : 0], `${watts(q.watts)} →`)

        const us = V.sweep.map((_, i) => i / (V.sweep.length - 1))
        curve.points(us, V.sweep.map((s) => py(Math.min(T_MAX, s.theta))), null)
        const u = (q.fins - 2) / 22
        marker.position.set(plot.s.xAt(u), py(Math.min(T_MAX, V.theta)), 0.46)
        best.position.set(plot.s.xAt((V.best.fins - 2) / 22), py(Math.min(T_MAX, V.best.theta)), 0.44)
        cursor(u)
        plot.right.set(`${q.fins} fins: ${thetaText(V.theta)} · best ${V.best.fins}`, q.fins === V.best.fins ? POWER : RING)

        const tone = tjTone(V.tj)
        rows[0].set(`junction ${celsiusText(V.tj)} (limit ${TJ_MAX} °C)`, toneColor[tone!])
        rows[1].set(`fin gap ${mmTenths(V.gap)} · h ${fixedText(V.h, 1)} W/(m²·K) · fin efficiency ${pct(V.eta)}`, LABEL)
        rows[2].set(`joint ${SINK_MOUNTS[q.mount].name.toLowerCase()}: ${thetaText(V.thetas[1])}`, V.thetas[1] > 5 ? HIGH_V : V.thetas[1] > 1 ? HEAT : POWER)
        rows[3].set(A.boxed ? `box air +${celsiusText(V.box.rise)} from ${watts(P_all)} inside` : `sink sits in ${AMB} °C room air`, A.boxed && V.box.rise > 20 ? HEAT : GREY)
        head.status.set(`Heatsinks · ${watts(q.watts)} · ${q.fins} fins · ${SINK_ORIENT[q.orient].name.toLowerCase()}`)
        head.sub.set(`TO-220 MOSFET (θjc ${TAB.thetaJC} °C/W) on a 40 × 40 × 20 mm aluminium sink; values typical`, GREY)
        const choked = q.fins > V.best.fins + 3
        head.event.set(
          V.tj >= TJ_MAX
            ? 'TOO HOT: junction past the limit, fix the biggest drop in the chain'
            : choked
              ? 'fins too dense: the warm air cannot get out between them'
              : q.fins < V.best.fins - 3
                ? 'fins too sparse: not enough area'
                : V.tj > 110
                  ? 'works, but little margin: a hot day or a closed lid tips it over'
                  : 'cool enough, with margin',
          V.tj >= TJ_MAX ? HIGH_V : choked || V.tj > 110 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { V } = hsRun(p)
        return [
          { label: 'Junction', value: celsiusText(V.tj), tone: tjTone(V.tj) },
          { label: 'Sink to air θsa', value: thetaText(V.theta) },
          { label: 'Best fin count', value: `${V.best.fins} (${thetaText(V.best.theta)})` },
          { label: 'Air around the sink', value: celsiusText(V.airC), tone: toneOf(V.box.rise < 10, V.box.rise < 30) },
        ]
      },
    }
  },
}

// --- Motor heating: a 15 cm arm joint holding a payload; servo current follows the load, stepper current is set by the driver. ---

const DRIVE_NAMES: Record<JointDrive, string> = { servo: 'MG996R servo', stepper: 'NEMA17 + 5:1 belt' }
const AMBIENTS = { a25: '25 °C room', a40: '40 °C inside the robot', a60: '60 °C closed box in the sun' }
const MH = { shoulder: [-13, -0.6, 0] as V3, armLen: 10, slow: 60, maxC: 160, droop: -0.55, bars: [-11.2, -8.6, 0] as V3 }
const mhParams = (p: Params) => {
  const drive = pick(DRIVE_NAMES, p.drive, 'servo') as JointDrive
  const ak = pick(AMBIENTS, p.amb, 'a25')
  return { drive, payloadKg: n(p, 'payload') / 1000, busy: n(p, 'busy') / 100, idle: n(p, 'idle') / 100, ambC: Number(ak.slice(1)) }
}
type MhQ = ReturnType<typeof mhParams>
const mhKey = (q: MhQ) => `${q.drive} ${q.payloadKg} ${q.busy} ${q.idle} ${q.ambC}`
const mhRun = memoBy(mhKey, (q: MhQ) => jointHeat(q))
const tempTone = (t: number, maxC: number) => toneOf(t < Math.min(maxC - 15, 80), t < maxC)

export const thermalDesignMotorHeating: Lesson = {
  id: 'thermal-design-motor-heating',
  title: 'Motor heating',
  tagline: 'Holding still can cook a motor: I²R heat with no motion at all',
  formula: (p) => {
    const q = mhParams(p)
    const R = mhRun(q)
    return `gravity torque = m·g·L + m_arm·g·L/2 = ${nmText(R.needNm)} · I_busy = ${amps(R.ampsBusy)}, I_idle = ${amps(R.ampsIdle)} · P = I²R → ${watts(R.wattsBusy)} / ${watts(R.wattsIdle)} · steady T = Ta + Rth·(D·P_busy + (1 − D)·P_idle) = ${q.ambC} + ${R.d.kPerW} K/W × … ≈ ${Number.isFinite(R.steadyC) ? celsiusText(R.steadyC) : 'runaway'} vs ${celsiusText(R.d.maxC)} · τ = ${minText(R.d.tauS)} (typical)`
  },
  legend: [
    { color: RING, label: 'Winding temperature (time-lapse)', shape: 'dot' },
    { color: HIGH_V, label: 'Winding / plastics limit', shape: 'dot' },
    { color: HEAT, label: `PLA mount creeps (${PLA_CREEP_C} °C)`, shape: 'dot' },
    { color: FORCE, label: 'Payload weight', shape: 'dot' },
  ],
  points: [
    'A motor heats with I²R in its copper whether it turns or not. Holding an arm level is a stall: no motion, no useful work, all of the current turns into heat. The winding warms along its thermal time constant (about a minute for a small servo, 15 minutes for a NEMA17, typical) toward ambient + P·Rth. The general model is Actuators › Motor selection › Thermal limits.',
    'A servo draws current in proportion to the torque it must hold, and the torque is the static balance of the arm: m·g·L for the payload plus the arm\'s own weight at half length (Mechanics › Torque & levers › Static balance). Double the payload or the reach and the heat roughly quadruples. Park the arm hanging down, or on a rest, between jobs and the servo cools.',
    'Two ratings: peak (stall) torque is what the motor can give for seconds, continuous torque what it can hold forever without passing its temperature limit, often a third of the peak. In warmer air there is less headroom, so the continuous rating falls as √(T_max − T_air): a robot\'s insides or a closed box in the sun derate every motor. See DC motors › Torque-speed curve.',
    'A stepper is the opposite: its driver pushes the set current through both coils all the time, loaded or not, so it runs hot even holding nothing (Actuators › Stepper motors). Drivers drop to an idle current after a pause (TMC2209 IHOLD, typical 30–50 %): heat falls with I², holding torque only with I, so half current means a quarter of the heat and still half the holding torque. Too low and the arm sags.',
    'Hot motors also heat what they bolt to: a PLA bracket creeps above about 60 °C, so a stepper at 70 °C slowly tilts its own mount. Fixes, in order: a bigger motor or gear ratio, a counter-spring or counterweight so gravity torque is near zero, park the load, idle-current reduction, and airflow or an aluminium mount as a heatsink.',
  ],
  controls: [
    { kind: 'choice', key: 'drive', options: opts(DRIVE_NAMES), initial: 'servo' },
    { kind: 'slider', key: 'payload', label: 'Payload at 15 cm', min: 0, max: 400, step: 25, initial: 200, format: (v) => `${v} g` },
    { kind: 'slider', key: 'busy', label: 'Working share', min: 10, max: 100, step: 10, initial: 100, format: (v) => `${v} % of each minute` },
    { kind: 'slider', key: 'idle', label: 'Stepper idle current', min: 20, max: 100, step: 10, initial: 100, format: (v) => `${v} %` },
    { kind: 'choice', key: 'amb', options: opts(AMBIENTS), initial: 'a25' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const S = MH.shoulder
    const steel = mat('#5d636c', { metal: 0.4, rough: 0.5 })
    box(scene, [1.6, S[1] + 6.6, 1.6], steel, [S[0], (S[1] - 6.6) / 2 - 0.9, -2.4])
    const servoG = add(scene, new THREE.Group(), [S[0] + 0.75 * 1.7, S[1], -1.75 * 1.7])
    servoG.scale.setScalar(1.7)
    const horn = sg90Servo(servoG, [0, 0, 0])
    const servoTint = heatTint(servoG)
    const stepG = add(scene, new THREE.Group(), [S[0], S[1], -0.2])
    const stepper = nema17(stepG, [0, 0, 0], 1.3)
    const stepTint = heatTint(stepG)
    const arm = add(scene, new THREE.Group(), [S[0], S[1], 0.6])
    const L = MH.armLen
    box(arm, [L + 1, 0.7, 0.4], mat('#c9ccd2', { metal: 0.5, rough: 0.4 }), [L / 2, 0, 0])
    cylinder(arm, 0.6, 0.6, steel, [0, 0, 0.1], 'z', 24)
    const payload = box(arm, [1.8, 1.8, 1.8], mat('#8a6a3c', { rough: 0.7 }), [L, -1.25, 0])
    const weight = forceArrow(scene, FORCE, { r: 0.12, size: 0.3 })
    const waves = heatWaves(scene, 3, { count: 4, rise: 1.5 })
    waves.group.position.set(S[0], S[1] + 2.2, 0)
    const restAt = 6
    box(scene, [0.8, 3.6, 0.8], steel, [S[0] + restAt * Math.cos(MH.droop), S[1] + restAt * Math.sin(MH.droop) - 2.2, 0.6])
    addLabel(scene, 'rest', [S[0] + restAt * Math.cos(MH.droop) + 0.7, S[1] + restAt * Math.sin(MH.droop) - 3.4, 0.6], GREY, 0.26, 'left')
    const motorTag = liveLabel(scene, [S[0] + 1.4, S[1] - 3.1, 1], { size: 0.32, align: 'left' })
    addLabel(scene, 'torque at the joint', [MH.bars[0] - 5, MH.bars[1] + 0.95, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, MH.bars, ['gravity needs', 'continuous', 'peak', 'idle hold'], 6.4, { row: 0.75, size: 0.26 })

    const P = WIDE_RIGHT
    const plot = titledScope(scene, P.y, P.h, `winding, 0 … ${MH.maxC} °C`, RING, 0, P.x, P.w)
    const yOf = plotY(0, MH.maxC, P.h)
    const limit = plot.s.level(HIGH_V)
    plot.s.level(HEAT, 0.5).set(yOf(PLA_CREEP_C))
    const steady = plot.s.level(GREY, 0.3)
    const tr = plot.s.trace(RING, { samples: 200, radius: 0.08 })
    const cursor = cursorBar(plot.s, GREY, 0.05)
    plot.lo.set('0')
    plot.hi.set(`${ARM_JOINT.seconds / 60} min`)
    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    const clock = lapseClock(ARM_JOINT.seconds, MH.slow, 300)
    const st = { angle: 0, rotor: 0, t: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const q = mhParams(p)
        const R = mhRun(q)
        const now = clock(dt, mhKey(q))
        const f = fixedStepAt(R.run, now, ARM_JOINT.dt)
        const servo = q.drive === 'servo'
        servoG.visible = servo
        stepG.visible = !servo
        st.t += dt
        let target = 0
        if (servo) target = !R.canLift ? MH.droop : f.busy ? 0 : MH.droop
        else target = f.busy ? 0.25 * Math.sin(st.t * 2.2) : R.slipsIdle ? MH.droop : 0
        st.angle = glide(dt, st.angle, target, 8)
        arm.rotation.z = st.angle
        horn.rotation.z = st.angle - Math.PI / 2
        const ia = servo ? 0 : (f.busy ? 1 : q.idle) * Math.cos(st.rotor)
        if (!servo && f.busy) st.rotor += dt * 2
        stepper.set(st.angle * ARM_JOINT.beltRatio, ia, servo ? 0 : (f.busy ? 1 : q.idle) * Math.sin(st.rotor))
        const hot = (f.tempC - q.ambC) / (R.d.maxC - q.ambC + 20)
        ;(servo ? servoTint : stepTint)(hot)
        waves.step(dt, hot)
        const tip: V3 = [S[0] + L * Math.cos(st.angle), S[1] + L * Math.sin(st.angle) - 2.2, 1.6]
        payload.visible = q.payloadKg > 0
        if (q.payloadKg > 0 && st.angle > -0.3) weight(tip, [tip[0], tip[1] - 1 - q.payloadKg * 6, tip[2]], `${Math.round(q.payloadKg * 1000)} g · ${newtonsText(q.payloadKg * 9.81, 1)}`, [1.9, 0.9, 0])
        else weight([0, 0, 0], [0, 0, 0], '')
        motorTag.set(`${DRIVE_NAMES[q.drive]} ${celsiusText(f.tempC)}`, toneColor[tempTone(f.tempC, R.d.maxC)!])

        bars.rename(2, servo ? 'peak (stall)' : 'hold, full I')
        bars.set(
          [R.needNm, R.contNm, R.peakNm, R.idleHoldNm],
          [nmText(R.needNm), `${nmText(R.contNm)} at ${q.ambC} °C`, nmText(R.peakNm), servo ? 'n/a for a servo' : nmText(R.idleHoldNm)],
          [FORCE, R.needNm > R.contNm ? HIGH_V : POWER, GREY, R.slipsIdle ? HIGH_V : POWER],
        )

        traceRun(tr, R.run, ARM_JOINT.dt, ARM_JOINT.seconds, now, (x) => yOf(Math.min(MH.maxC, x.tempC)))
        cursor(now / ARM_JOINT.seconds)
        limit.set(yOf(R.d.maxC))
        steady.set(yOf(Math.min(MH.maxC, R.steadyC)))
        plot.right.set(`steady ${Number.isFinite(R.steadyC) && R.steadyC < 999 ? celsiusText(R.steadyC) : 'runaway'} · τ ${minText(R.d.tauS)}`, toneColor[tempTone(R.steadyC, R.d.maxC)!])

        rows[0].set(`busy ${amps(R.ampsBusy)} → ${watts(R.wattsBusy)} · idle ${amps(R.ampsIdle)} → ${watts(R.wattsIdle)}`, LABEL)
        rows[1].set(`steady ${Number.isFinite(R.steadyC) && R.steadyC < 999 ? celsiusText(R.steadyC) : 'runaway'}, limit ${celsiusText(R.d.maxC)}`, toneColor[tempTone(R.steadyC, R.d.maxC)!])
        rows[2].set(R.overAt !== null ? `passes the limit after ${minText(R.overAt)}` : R.steadyC > PLA_CREEP_C ? `over ${PLA_CREEP_C} °C: a PLA mount creeps` : 'stays cool', R.overAt !== null ? HIGH_V : R.steadyC > PLA_CREEP_C ? HEAT : POWER)
        rows[3].set(servo ? 'servo current follows the load' : `stepper current is set: ${pct(q.idle)} when idle`, GREY)
        head.status.set(`Motor heating · ${DRIVE_NAMES[q.drive]} · ${Math.round(q.payloadKg * 1000)} g · ${q.ambC} °C air`)
        head.sub.set(`t = ${minText(now)}, time-lapse ${MH.slow}× · ${f.busy ? (servo ? 'holding the arm out' : 'moving') : servo ? 'parked, arm hanging' : 'idle, holding'}`, GREY)
        head.event.set(
          !R.canLift
            ? 'cannot lift it: the load needs more than the stall torque'
            : R.slipsIdle
              ? 'idle current too low: the arm sags when the stepper rests'
              : R.overAt !== null
                ? 'OVERHEATS: the winding passes its limit'
                : R.needNm > R.contNm && q.busy >= 0.99
                  ? 'over the continuous rating'
                  : R.steadyC > PLA_CREEP_C
                    ? 'runs, but hot enough to soften a PLA mount'
                    : 'within its continuous rating',
          !R.canLift || R.slipsIdle || R.overAt !== null ? HIGH_V : R.steadyC > PLA_CREEP_C ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const q = mhParams(p)
        const R = mhRun(q)
        return [
          { label: 'Torque needed', value: nmText(R.needNm), tone: toneOf(R.needNm <= R.contNm, R.canLift) },
          { label: `Continuous at ${q.ambC} °C`, value: nmText(R.contNm) },
          { label: 'Heat, busy / idle', value: `${watts(R.wattsBusy)} / ${watts(R.wattsIdle)}` },
          { label: 'Steady winding', value: Number.isFinite(R.steadyC) && R.steadyC < 999 ? celsiusText(R.steadyC) : 'runaway', tone: tempTone(R.steadyC, R.d.maxC) },
        ]
      },
    }
  },
}
