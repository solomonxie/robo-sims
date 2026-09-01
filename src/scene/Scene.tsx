import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import catalog from '../catalog/catalog.json'
import { CatalogEntry } from '../catalog/types'
import { useSceneStore } from '../state/store'
import { Breadboard } from './Breadboard'
import { Resistor } from './parts/Resistor'

const catalogByName = new Map((catalog as unknown as CatalogEntry[]).map((entry) => [entry.name, entry]))

export function Scene() {
  const parts = useSceneStore((s) => s.parts)
  const draggingId = useSceneStore((s) => s.draggingId)

  return (
    <Canvas
      shadows
      camera={{ position: [3, 3, 4], fov: 50 }}
      onPointerMissed={() => useSceneStore.getState().selectPart(null)}
    >
      <color attach="background" args={['#1e1e24']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} castShadow />
      <gridHelper args={[40, 40, '#333333', '#2a2a2a']} />

      <Breadboard />

      {parts.map((part) => {
        const entry = catalogByName.get(part.catalogName)
        if (!entry || entry.type !== 'resistor') return null
        return <Resistor key={part.id} id={part.id} ohms={entry.specs.ohms as number} position={part.position} />
      })}

      <OrbitControls makeDefault enabled={draggingId === null} />
    </Canvas>
  )
}
