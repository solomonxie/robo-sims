import { Instance, Instances } from '@react-three/drei'
import { useMemo } from 'react'
import { generateHoles } from '../breadboard/layout'

const HOLE_SPACING = 0.2 // world units per breadboard hole (0.1" grid, scaled up)
const COLUMNS = 30

/** Maps a hole's (row, col) to a world position on the board. Exported so
 *  parts can snap their pins to real hole coordinates later (M2). */
export function holeWorldPosition(row: string, col: number): [number, number] {
  const rowIndex = ['+', '-', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].indexOf(row)
  const gap = row === 'f' || row === 'g' || row === 'h' || row === 'i' || row === 'j' ? 0.3 : 0
  return [(col - 1) * HOLE_SPACING - (COLUMNS * HOLE_SPACING) / 2, rowIndex * HOLE_SPACING + gap]
}

export function Breadboard() {
  const holes = useMemo(() => generateHoles(COLUMNS), [])
  const boardWidth = COLUMNS * HOLE_SPACING + 0.4
  const boardDepth = 12 * HOLE_SPACING + 0.6

  return (
    <group>
      <mesh position={[0, -0.05, 1]} receiveShadow>
        <boxGeometry args={[boardWidth, 0.1, boardDepth]} />
        <meshStandardMaterial color="#e8e4d8" />
      </mesh>
      <Instances limit={holes.length} range={holes.length}>
        <cylinderGeometry args={[0.02, 0.02, 0.06, 8]} />
        <meshStandardMaterial color="#2a2a2a" />
        {holes.map((hole) => {
          const [x, z] = holeWorldPosition(hole.row, hole.col)
          return <Instance key={`${hole.row}${hole.col}`} position={[x, 0.001, z]} />
        })}
      </Instances>
    </group>
  )
}
