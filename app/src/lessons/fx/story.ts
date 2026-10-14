// A looped, stepped animation: a Step slider at 0 plays every step in turn, 1..n holds one.
import { SliderControl } from '../types'

export const storySlider = (steps: readonly string[]): SliderControl => ({
  kind: 'slider',
  key: 'step',
  label: 'Step',
  min: 0,
  max: steps.length,
  initial: 0,
  step: 1,
  format: (v) => (v === 0 ? 'Play all' : `${v}. ${steps[v - 1]}`),
})

/** Clock for steps lasting `seconds[k]`; `frame(dt, pinned)` with pinned 0 = loop all, k = repeat step k. */
export function storyClock(seconds: number[]) {
  const s = { step: 0, t: 0, pinned: -1 }
  return {
    /** Current step, 0-based. */
    get step() {
      return s.step
    },
    /** Progress through the current step, 0..1. */
    get t() {
      return s.t
    },
    /** 1 once step `k` is done, its progress while it plays, 0 before. */
    done: (k: number) => (s.step > k ? 1 : s.step < k ? 0 : s.t),
    frame(dt: number, pinned: number) {
      if (pinned !== s.pinned) Object.assign(s, { pinned, step: Math.max(0, pinned - 1), t: 0 })
      s.t += dt / seconds[s.step]
      if (s.t < 1) return
      s.t %= 1
      if (pinned === 0) s.step = (s.step + 1) % seconds.length
    },
  }
}
