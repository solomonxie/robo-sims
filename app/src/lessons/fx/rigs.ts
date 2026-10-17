// Side-view time-lapse furniture: camera, status header, tilted metre rigs, scope labels and traces of a fixed-step run.
import * as THREE from 'three/webgpu'
import { fixedStepAt } from '../../core/physics'
import { V3, add } from '../../models/kit'
import { GREY, LABEL } from './colors'
import { scope } from './screens'
import { addLabel, liveLabel } from './text'

/** Straight side-on camera centred at (x, y). */
export const sideView = (x: number, y: number) => ({ center: [x, y, 0] as V3, radius: 52, polar: 1.45, azimuth: 0 })
export const SIDE_VIEW = sideView(-2.2, -0.4)
export const SIDE_SCOPE = { x: 6.4, w: 10.5 }

export function statusHeader(scene: THREE.Object3D) {
  return {
    status: liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' }),
    sub: liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' }),
    event: liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' }),
  }
}

/** Metres group (z up), viewed `tilt` rad from the side; `holder` turns a model so its nose points into the screen. */
export function tiltRig(parent: THREE.Object3D, origin: V3, k: number, tilt: number) {
  const g = add(parent, new THREE.Group(), origin)
  g.scale.setScalar(k)
  g.rotation.x = -Math.PI / 2 + tilt
  const holder = add(g, new THREE.Group())
  holder.rotation.z = Math.PI / 2
  return { g, holder }
}

/** Titles above and a 0…`seconds` axis below a `SIDE_SCOPE` plot centred at `y`, `h` tall. */
export function scopeLabels(scene: THREE.Object3D, y: number, h: number, seconds: number | null, left: string, right?: string) {
  const { x, w } = SIDE_SCOPE
  if (left) addLabel(scene, left, [x - w / 2, y + h / 2 + 1.1, 0.3], LABEL, 0.3, 'left')
  if (right) addLabel(scene, right, [x + w / 2, y + h / 2 + 1.1, 0.3], LABEL, 0.3, 'right')
  if (seconds === null) return
  addLabel(scene, '0', [x - w / 2, y - h / 2 - 1.1, 0.3], GREY, 0.26, 'left')
  addLabel(scene, `${seconds} s`, [x + w / 2, y - h / 2 - 1.1, 0.3], GREY, 0.26, 'right')
}

/** Draws `value(frame)` (scene units from the centre) of a run sampled every `dt`, from 0 to `now`. */
export function traceRun<T>(tr: ReturnType<ReturnType<typeof scope>['trace']>, run: readonly T[], dt: number, seconds: number, now: number, value: (f: T) => number, samples = 200) {
  const k = Math.max(2, Math.round((Math.min(now, seconds) / seconds) * (samples - 1)) + 1)
  const us: number[] = []
  const ys: number[] = []
  for (let i = 0; i < k; i++) {
    const u = i / (samples - 1)
    us.push(u)
    ys.push(value(fixedStepAt(run, u * seconds, dt)))
  }
  tr.points(us, ys)
}

/** `scope` of `SIDE_SCOPE` width centred at height `y`. */
export function sideScope(scene: THREE.Object3D, y: number, h: number, opts: Parameters<typeof scope>[3]) {
  const s = scope(scene, SIDE_SCOPE.w, h, opts)
  s.group.position.set(SIDE_SCOPE.x, y, 0)
  return s
}

/** Time-lapse clock: sim time 0…`seconds` at `slow`×, holds `rest` s of sim time, loops; restarts on a new key. */
export function lapseClock(seconds: number, slow: number, rest: number) {
  const st = { key: '', t: 0 }
  return (dt: number, key: string) => {
    if (key !== st.key) [st.key, st.t] = [key, 0]
    st.t += dt * slow
    if (st.t > seconds + rest) st.t = 0
    return Math.min(st.t, seconds)
  }
}

/** Scope `w` × `h` at (x, y) with zero at the bottom, titles above and a 0…`seconds` axis below. */
export function plotPanel(scene: THREE.Object3D, at: V3, w: number, h: number, seconds: number, left: string, right: string, zeroAt = 0, xDivs = seconds * 2) {
  const plot = scope(scene, w, h, { divs: [xDivs, 4], zeroAt })
  plot.group.position.set(...at)
  addLabel(scene, left, [at[0] - w / 2, at[1] + h / 2 + 1.1, 0.3], LABEL, 0.3, 'left')
  addLabel(scene, right, [at[0] + w / 2, at[1] + h / 2 + 1.1, 0.3], LABEL, 0.3, 'right')
  addLabel(scene, '0', [at[0] - w / 2, at[1] - h / 2 - 1.1, 0.3], GREY, 0.26, 'left')
  addLabel(scene, `${seconds} s`, [at[0] + w / 2, at[1] - h / 2 - 1.1, 0.3], GREY, 0.26, 'right')
  return plot
}

/** Scope `SIDE_SCOPE` wide at (x, y) with a left title, a live right title and live min/max axis labels under it. */
export function titledScope(scene: THREE.Object3D, y: number, h: number, title: string, color: string, zeroAt = 0, x = SIDE_SCOPE.x, w = SIDE_SCOPE.w) {
  const s = scope(scene, w, h, { divs: [10, 4], zeroAt })
  s.group.position.set(x, y, 0)
  addLabel(scene, title, [x - w / 2, y + h / 2 + 1.1, 0.3], color, 0.3, 'left')
  const right = liveLabel(scene, [x + w / 2, y + h / 2 + 1.1, 0.3], { size: 0.28, align: 'right' })
  const lo = liveLabel(scene, [x - w / 2, y - h / 2 - 0.9, 0.3], { size: 0.26, color: GREY, align: 'left' })
  const hi = liveLabel(scene, [x + w / 2, y - h / 2 - 0.9, 0.3], { size: 0.26, color: GREY, align: 'right' })
  return { s, right, lo, hi, h }
}

/** `k` left-aligned live text rows from (x, y) down, `gap` apart. */
export const textRows = (scene: THREE.Object3D, k: number, x = 2.7, y = -3.3, size = 0.34, gap = 0.8) => Array.from({ length: k }, (_, i) => liveLabel(scene, [x, y - i * gap, 0.2], { size, align: 'left' }))
/** Maps a value in [lo, hi] onto a plot `h` tall (scene units from its centre). */
export const plotY = (lo: number, hi: number, h: number) => (v: number) => ((v - lo) / (hi - lo)) * h - h / 2
