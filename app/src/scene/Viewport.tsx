import React, { useEffect, useMemo, useRef } from 'react'
import { GestureResponderEvent, PanResponder, StyleSheet, View } from 'react-native'
import { Canvas, CanvasRef } from 'react-native-webgpu'
import * as THREE from 'three/webgpu'
import { FOV, Orbit } from './orbit'
import { clearColor } from './stage'

interface Props {
  scene: THREE.Scene
  orbit: Orbit
  autoRotate?: boolean
  /** Bump to redraw after mutating the scene. */
  version?: number
  /** Nearest ancestor with `userData.partId`, or null for empty space. */
  onTap?: (part: THREE.Object3D | null) => void
  /** Animation hook, called every frame (seconds); keeps the view redrawing. */
  onFrame?: (dt: number) => void
}

const TAP_SLOP = 8
const TAP_MS = 300

export function Viewport({ scene, orbit, autoRotate = false, version = 0, onTap, onFrame }: Props) {
  const canvas = useRef<CanvasRef>(null)
  const camera = useMemo(() => new THREE.PerspectiveCamera(FOV, 1, 0.5, 2000), [])
  const size = useRef({ w: 1, h: 1 })
  const dirty = useRef(true)
  const spin = useRef(autoRotate)
  const frameRef = useRef(onFrame)
  frameRef.current = onFrame
  const tapAt = useRef<(x: number, y: number) => void>(() => {})

  useEffect(() => {
    dirty.current = true
  }, [version, scene])

  useEffect(() => {
    spin.current = autoRotate
  }, [autoRotate])

  useEffect(() => {
    const context = canvas.current!.getContext('webgpu')!
    const { width, height } = context.canvas as unknown as { width: number; height: number }
    camera.aspect = width / height
    camera.updateProjectionMatrix()

    const renderer = new THREE.WebGPURenderer({ antialias: true, canvas: context.canvas as any, context })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.setClearColor(clearColor())
    renderer.init()

    let last = 0
    renderer.setAnimationLoop((time: number) => {
      const dt = last ? Math.min(time - last, 50) : 0
      last = time
      if (frameRef.current) {
        frameRef.current(dt / 1000)
        dirty.current = true
      }
      if (spin.current) {
        orbit.azimuth += dt * 0.00025
        dirty.current = true
      }
      if (!dirty.current) return
      dirty.current = false
      orbit.apply(camera)
      renderer.render(scene, camera)
      context.present()
    })
    return () => disposeRenderer(renderer)
  }, [scene, camera, orbit])

  const responder = useMemo(() => {
    let prev: { x: number; y: number; dist: number; count: number } | null = null
    let start = { t: 0, x: 0, y: 0, moved: false }

    const read = (e: GestureResponderEvent) => {
      const t = e.touchHistory.touchBank.filter((b) => b && b.touchActive)
      if (t.length >= 2) {
        const [a, b] = t
        return {
          x: (a.currentPageX + b.currentPageX) / 2,
          y: (a.currentPageY + b.currentPageY) / 2,
          dist: Math.hypot(a.currentPageX - b.currentPageX, a.currentPageY - b.currentPageY),
          count: 2,
        }
      }
      return { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, dist: 0, count: 1 }
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        prev = read(e)
        start = { t: Date.now(), x: e.nativeEvent.locationX, y: e.nativeEvent.locationY, moved: false }
        spin.current = false
      },
      onPanResponderMove: (e, g) => {
        const cur = read(e)
        if (Math.hypot(g.dx, g.dy) > TAP_SLOP || cur.count > 1) start.moved = true
        if (prev && prev.count === cur.count) {
          if (cur.count === 1) orbit.pan(cur.x - prev.x, cur.y - prev.y)
          else {
            if (prev.dist > 0) orbit.zoom(cur.dist / prev.dist)
            orbit.rotate(cur.x - prev.x, cur.y - prev.y)
          }
          dirty.current = true
        }
        prev = cur
      },
      onPanResponderRelease: () => {
        prev = null
        if (!start.moved && Date.now() - start.t < TAP_MS) tapAt.current(start.x, start.y)
      },
    })
  }, [orbit])

  const pick = (x: number, y: number): THREE.Object3D | null => {
    const ndc = new THREE.Vector2((x / size.current.w) * 2 - 1, -(y / size.current.h) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, camera)
    for (const hit of ray.intersectObjects(scene.children, true)) {
      let o: THREE.Object3D | null = hit.object
      while (o && o.userData.partId === undefined) o = o.parent
      if (o) return o
    }
    return null
  }
  tapAt.current = (x, y) => onTap?.(pick(x, y))

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e) => (size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <Canvas ref={canvas} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={StyleSheet.absoluteFill} collapsable={false} {...responder.panHandlers} />
    </View>
  )
}

// Stops three's internal loop and drops listeners left on the shared QuadMesh
// geometry, so the renderer can be garbage collected (react-native-webgpu#445).
function disposeRenderer(renderer: THREE.WebGPURenderer) {
  renderer.setAnimationLoop(null)
  renderer.dispose()
  const quad = new (THREE.QuadMesh as any)() as THREE.QuadMesh
  for (const target of [quad.geometry, quad.geometry.index, ...Object.values(quad.geometry.attributes)] as any[]) {
    if (target?._listeners) target._listeners = {}
  }
}
