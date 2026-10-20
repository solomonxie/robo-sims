// Using the meter itself: dial + red-socket controls, the misuse wording, and a fault-hunt rig where every probe needs the
// right setup first (a wrong one shows what the meter really does: OL, 0, a short, a blown fuse).
import { DMM, DmmDial, DmmJack, DmmMiss, DmmResult, DmmSetup, MeterWant, dmmReading, dmmText, dmmUnitText, sameReading, stillSuspect } from '../../core/physics'
import { si, volts } from '../../core/units'
import { Control, Params, Readout, Stage, huntReadout, opts, pick } from '../types'
import { glowHalo } from './circuit'
import { GREY, HEAT, HIGH_V, LABEL, POWER, RING } from './colors'
import { HuntBench, HuntCase, HuntQ, RigTable, glowGuess, huntStage, probeMeter, readingText, rigTable } from './faults'
import { FACE_VIEW } from './rigs'
import { liveLabel } from './text'
import { V3 } from '../../models/kit'

const DMM_DIALS: Record<DmmDial, string> = { vdc: 'V⎓ volts', vac: 'V~ AC volts', mv: 'mV⎓', ohm: 'Ω ohms', beep: '))) beeper', diode: '▷| diode', ma: 'mA', amp: 'A' }
/** Dial names for 3D text (the stroke font has no ⎓ or ▷). */
const DIAL_TEXT: Record<DmmDial, string> = { vdc: 'V DC', vac: 'V~', mv: 'mV DC', ohm: 'Ω', beep: 'beeper', diode: 'diode test', ma: 'mA', amp: 'A' }
const DMM_JACKS: Record<DmmJack, string> = { v: 'Red in VΩ', ma: 'Red in mA', a10: 'Red in 10A' }

/** Dial and red-socket choices. */
export const dmmControls = (dial: DmmDial, jack: DmmJack): Control[] => [
  { kind: 'choice', key: 'dial', options: opts(DMM_DIALS), initial: dial },
  { kind: 'choice', key: 'jack', options: opts(DMM_JACKS), initial: jack },
]
const dmmSetupOf = (p: Params): DmmSetup => ({ dial: pick(DMM_DIALS, p.dial, 'vdc'), jack: pick(DMM_JACKS, p.jack, 'v') })
const setupText = (s: DmmSetup) => `${DIAL_TEXT[s.dial]}, ${DMM_JACKS[s.jack].replace("Red", "red")}`

const A = (a: number) => si(Math.abs(a), 'A', 2)
const FUSE_NAME: Record<DmmJack, string> = { v: '', ma: 'F400mA', a10: 'F10A' }

/** Header line for a setup mistake, with the meter's own numbers. */
function dmmMissText(miss: DmmMiss, want: MeterWant, s: DmmSetup, r: DmmResult): string {
  switch (miss) {
    case 'short':
      return `Dead short: red in ${s.jack === 'ma' ? 'mA' : '10A'} is a ${si(s.jack === 'ma' ? DMM.ma.ohms : DMM.a10.ohms, 'Ω', 2)} shunt on every dial; ${A(r.amps)} through the leads`
    case 'fuse':
      return `Pop: ${A(r.meltA)}${r.meltA > 1.5 * Math.abs(r.amps) ? ' as the motor starts' : ''} melts the ${FUSE_NAME[r.blown ?? 'ma']} in ${si(r.meltS, 's', 2)}; it reads 0 till replaced`
    case 'jack':
      if (want !== 'amp') return `Red in ${s.jack === 'ma' ? 'mA' : '10A'}: the VΩ input is open, it reads ${dmmReading(r)}. Red back in VΩ`
      return s.jack === 'v' ? 'Red in VΩ on an amps range: no path through the meter, it reads 0' : `The ${s.dial === 'ma' ? 'mA' : 'A'} range reads the other socket’s shunt: 0`
    case 'dial':
      if (want === 'amp')
        return s.dial === 'vdc' || s.dial === 'mv' || s.dial === 'vac' ? `Voltmeter in series: 10 MΩ in the loop, the robot gets nothing, the meter reads the gap: ${dmmReading(r)}` : `${DIAL_TEXT[s.dial]} in a powered loop: nonsense (${dmmReading(r)})`
      if (want === 'vdc') return s.dial === 'vac' ? 'V~ is AC-coupled: steady DC reads 0' : `${DIAL_TEXT[s.dial]} with red in VΩ: nothing flows through the meter, 0`
      return want === 'diode' ? `${DIAL_TEXT[s.dial]} on a diode: the reading depends on the test current (${dmmReading(r)}); use the diode test` : `${DIAL_TEXT[s.dial]} on an unpowered wire reads ${dmmReading(r)}: use ))) or Ω`
    case 'range':
      return want === 'amp' ? `Over the mA range: OL. Use the 10A socket` : `mV DC tops out at ${si(DMM.mvMax, 'V', 1)}: OL. Use V DC`
    case 'live':
      return want === 'vdc' ? `${DIAL_TEXT[s.dial]} on a live rail: its test source fights the circuit (${dmmReading(r)}). Volts on V DC` : `Powered: Ω reads its ${volts(DMM.ohmOpenV)} test source plus the circuit’s volts: ${dmmReading(r)}. Pack out first`
    case 'com':
      return `COM isn’t on GND: the meter reads red − black = ${dmmReading(r)}`
  }
}

export const METER_LEGEND = [
  { color: POWER, label: 'Fair reading / found', shape: 'dot' as const },
  { color: RING, label: 'Probing / beeper', shape: 'dot' as const },
  { color: HIGH_V, label: 'Misuse / ruled out', shape: 'dot' as const },
  { color: LABEL, label: 'Red probe + socket, black COM', shape: 'dot' as const },
]

/** One measurement: what the meter shows, the mistake (null = fair), the probe spots and where the red lead goes. */
interface MeterShot<T extends string> {
  r: DmmResult
  miss: DmmMiss | null
  want: MeterWant
  red: T
  black: T
}

interface MeterRigSpec<F extends string, P extends string, T extends string, S extends string> extends HuntCase<F, P, S> {
  bench: HuntBench<T, S>
  /** The meter on the bench for these params (memoised by the rig). */
  measure: (q: HuntQ<F, P>, s: DmmSetup, p: Params) => MeterShot<T>
  /** The part a short heats. */
  shorted: S
  table: RigTable
  meterAt?: V3
  extra?: (s: { q: HuntQ<F, P>; shot: MeterShot<T>; t: number; dt: number; found: boolean; p: Params }) => void
}

/** Shared frame: full meter (dial, red socket, probes), beeper, blown-fuse mark, short glow, header and table. A probe joins
 *  the "You measured" row only once it was read with a fair setup. */
export function meterRig<F extends string, P extends string, T extends string, S extends string>({ scene, header }: ReturnType<typeof huntStage>, s: MeterRigSpec<F, P, T, S>): Stage {
  const { bench, kit, hunt } = s
  const at = s.meterAt ?? [9.8, 0.4, 0]
  const k = 0.42
  const meter = probeMeter(scene, at, k, -3, true)
  const unit = liveLabel(scene, [at[0] + 3.2 * k, at[1] + 6.9 * k, 0.4], { size: 0.32, align: 'right' })
  const beep = liveLabel(scene, [at[0] + 4.9 * k, at[1] + 3.7 * k, 0.4], { size: 0.42, align: 'left' })
  const fuse = glowHalo(scene, [at[0] - 2.4 * k, at[1] - 4.6 * k, 0.8], 0.5)
  const table = rigTable(scene, kit, s.table)
  const track = kit.track()
  const cache = new Map<string, MeterShot<T>>()
  const st = { t: 0, seen: [] as P[], shot: null as MeterShot<T> | null }
  const shotOf = (q: HuntQ<F, P>, p: Params) => {
    const setup = dmmSetupOf(p)
    const key = `${q.truth}|${JSON.stringify({ ...p, guess: '', case: '' })}`
    let hit = cache.get(key)
    if (!hit) cache.set(key, (hit = s.measure(q, setup, p)))
    return hit
  }
  return {
    scene,
    view: FACE_VIEW,
    frame(dt: number, p: Params) {
      st.t += dt
      const q = kit.params(p)
      const setup = dmmSetupOf(p)
      const shot = shotOf(q, p)
      st.shot = shot
      st.seen = track(q, !shot.miss)
      meter.aim(bench.tp[shot.red], bench.tp[shot.black], setup.jack)
      meter.meter.dial(setup.dial)
      meter.meter.display.set(dmmText(shot.r).replace('−', '-'))
      unit.set(dmmUnitText(shot.r), GREY)
      const chirp = shot.r.beep === 'chirp' && Math.floor(st.t * 5) % 3 === 0
      beep.set(shot.r.beep === 'on' || chirp ? ')))' : '', RING)
      fuse.set(shot.r.blown ? 1 : 0, HIGH_V)
      bench.clearGlow()
      if (shot.miss === 'short') bench.glow(s.shorted, Math.min(1.6, Math.abs(shot.r.amps) / 4), HEAT)
      const found = glowGuess(bench, s.parts, q)
      s.extra?.({ q, shot, t: st.t, dt, found, p })
      if (shot.miss) header.set(s.symptom, { pass: false, near: false, fail: shot.miss }, dmmMissText(shot.miss, shot.want, setup, shot.r), `${setupText(setup)}: not a fair reading for this test point`, 'MISUSE')
      else {
        const [why, hint] = kit.words(q, st.seen, s.fixes, s.hint)
        header.set(s.symptom, kit.verdict(q), why, hint)
      }
      kit.fill(table, q, st.seen)
    },
    readouts(p: Params): Readout[] {
      const q = kit.params(p)
      const shot = st.shot ?? shotOf(q, p)
      const healthy = hunt.read('ok', q.probe)
      const fair = !shot.miss && sameReading(hunt.read(q.truth, q.probe), healthy)
      const beeps = shot.r.beep === 'on' ? ' · beep' : shot.r.beep === 'chirp' ? ' · chirps' : ''
      return [
        { label: 'Meter', value: `${dmmReading(shot.r)}${beeps}`, tone: shot.miss ? 'bad' : fair ? 'ok' : 'warn' },
        { label: 'Healthy reads', value: readingText(healthy) },
        { label: 'Suspects left', value: `${stillSuspect(hunt, q.truth, st.seen).length} of ${hunt.faults.length}` },
        huntReadout(kit.verdict(q)),
      ]
    },
  }
}
