import * as THREE from 'three/webgpu'

export const BACKGROUND = '#14161b'

/** Clear color that comes out as BACKGROUND, matching the RN views around the canvas.
 *  Neutral tone mapping runs over the whole frame and lowers dark colors by
 *  m − 6.25·m² (m = smallest channel); this adds that offset back in advance. */
export function clearColor(): THREE.Color {
  const t = new THREE.Color(BACKGROUND)
  const low = Math.min(t.r, t.g, t.b)
  const offset = Math.sqrt(low / 6.25) - low
  return new THREE.Color(t.r + offset, t.g + offset, t.b + offset)
}

/** Scene with sky/ground fill, one shadow-casting key light, and an optional desk. */
export function createStage({ deskY, span }: { deskY?: number; span: number }): THREE.Scene {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#eef3ff', '#3a3530', 1.6))

  const key = new THREE.DirectionalLight('#fff6e8', 2.6)
  key.position.set(span * 0.6, span * 1.2, span * 0.8)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  const cam = key.shadow.camera
  cam.left = cam.bottom = -span
  cam.right = cam.top = span
  cam.near = 1
  cam.far = span * 4
  key.shadow.bias = -0.0005
  scene.add(key)

  const rim = new THREE.DirectionalLight('#9fb8ff', 0.8)
  rim.position.set(-span, span * 0.5, -span)
  scene.add(rim)

  if (deskY !== undefined) {
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(span * 6, span * 6), new THREE.MeshStandardMaterial({ color: '#2b2e36', roughness: 0.9 }))
    desk.name = 'desk'
    desk.rotation.x = -Math.PI / 2
    desk.position.y = deskY
    desk.receiveShadow = true
    scene.add(desk)
  }
  return scene
}

/** Lowest point of an object, so it can be set down on a surface. */
export function bottomOf(obj: THREE.Object3D): number {
  obj.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(obj).min.y - obj.position.y
}
