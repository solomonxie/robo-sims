import { ThreeEvent } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { Plane, Vector3 } from 'three'
import { useSceneStore } from '../../state/store'
import { resistorColorBands } from './resistorColors'

interface ResistorProps {
  id: string
  ohms: number
  position: [number, number, number]
}

const BODY_LENGTH = 0.5
const BODY_RADIUS = 0.08
const dragPlane = new Plane(new Vector3(0, 1, 0), 0)

export function Resistor({ id, ohms, position }: ResistorProps) {
  const bands = resistorColorBands(ohms)
  const movePart = useSceneStore((s) => s.movePart)
  const selectPart = useSceneStore((s) => s.selectPart)
  const selectedId = useSceneStore((s) => s.selectedId)
  const [dragging, setDragging] = useState(false)
  const groupRef = useRef(null)

  const setStoreDragging = useSceneStore((s) => s.setDragging)

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    selectPart(id)
    setDragging(true)
    setStoreDragging(id)
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
  }

  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    setDragging(false)
    setStoreDragging(null)
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) return
    event.stopPropagation()
    const point = new Vector3()
    event.ray.intersectPlane(dragPlane, point)
    if (point) movePart(id, [point.x, position[1], point.z])
  }

  return (
    <group
      ref={groupRef}
      position={position}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
    >
      {/* leads */}
      <mesh position={[-BODY_LENGTH / 2 - 0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.01, 0.01, 0.3, 6]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[BODY_LENGTH / 2 + 0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.01, 0.01, 0.3, 6]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* body */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[BODY_RADIUS, BODY_RADIUS, BODY_LENGTH, 16]} />
        <meshStandardMaterial color="#d8c39a" />
      </mesh>
      {selectedId === id && (
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[BODY_RADIUS + 0.015, BODY_RADIUS + 0.015, BODY_LENGTH + 0.02, 16]} />
          <meshBasicMaterial color="#4da6ff" wireframe />
        </mesh>
      )}
      {/* color bands */}
      {bands.map((color, i) => (
        <mesh key={i} position={[-0.15 + i * 0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[BODY_RADIUS + 0.005, BODY_RADIUS + 0.005, 0.03, 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  )
}
