import * as THREE from 'three/webgpu'

export const FOV = 40

export interface OrbitLimits {
  minRadius: number
  maxRadius: number
  minPolar: number
  maxPolar: number
}

/** Spherical camera rig around a target: rotate, pinch-zoom, pan on the ground plane. */
export class Orbit {
  target = new THREE.Vector3()
  azimuth = Math.PI / 5
  polar = 0.95
  radius = 40

  constructor(public limits: OrbitLimits = { minRadius: 8, maxRadius: 500, minPolar: 0.12, maxPolar: 1.48 }) {}

  frame(center: THREE.Vector3, radius: number) {
    this.target.copy(center)
    this.radius = THREE.MathUtils.clamp(radius, this.limits.minRadius, this.limits.maxRadius)
  }

  rotate(dxPx: number, dyPx: number) {
    this.azimuth -= dxPx * 0.008
    this.polar = THREE.MathUtils.clamp(this.polar - dyPx * 0.008, this.limits.minPolar, this.limits.maxPolar)
  }

  zoom(scale: number) {
    this.radius = THREE.MathUtils.clamp(this.radius / scale, this.limits.minRadius, this.limits.maxRadius)
  }

  pan(dxPx: number, dyPx: number) {
    const k = this.radius * 0.0022
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth))
    const forward = new THREE.Vector3(Math.sin(this.azimuth), 0, Math.cos(this.azimuth))
    this.target.addScaledVector(right, -dxPx * k).addScaledVector(forward, -dyPx * k)
  }

  apply(camera: THREE.PerspectiveCamera) {
    const s = Math.sin(this.polar)
    camera.position.set(
      this.target.x + this.radius * s * Math.sin(this.azimuth),
      this.target.y + this.radius * Math.cos(this.polar),
      this.target.z + this.radius * s * Math.cos(this.azimuth),
    )
    camera.lookAt(this.target)
  }
}

/** Center and orbit radius that fit an object in view. */
export function fitObject(obj: THREE.Object3D, fovDeg: number): { center: THREE.Vector3; radius: number } {
  const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere())
  const radius = sphere.radius / Math.sin(THREE.MathUtils.degToRad(fovDeg / 2))
  return { center: sphere.center, radius: radius * 1.05 }
}
