// Drive-lesson helpers in floor metres: placing a robot at a Pose, field bounds, scripted stick tours.
import * as THREE from 'three/webgpu'
import { Pose } from '../../core/physics'

export const placeAt = (o: THREE.Object3D, p: Pose, z = 0) => {
  o.position.set(p.x, p.y, z)
  o.rotation.z = p.th
}

export const inField = (p: Pose, fx: [number, number], fy: [number, number]) => p.x >= fx[0] && p.x <= fx[1] && p.y >= fy[0] && p.y <= fy[1]

export const TOUR_MODES = { tour: 'Auto tour', sticks: 'Your sticks' }
/** One leg of a stick tour: twist `t` = [vx, vy, ω] held for `s` seconds. */
export type TourSeg = { name: string; short: string; t: [number, number, number]; s: number }
export const tourLength = (tour: TourSeg[]) => tour.reduce((a, x) => a + x.s, 0)
export function tourAt(tour: TourSeg[], t: number) {
  let u = t
  for (const seg of tour) {
    if (u < seg.s) return seg
    u -= seg.s
  }
  return tour[tour.length - 1]
}
