import { create } from 'zustand'

export interface PlacedPart {
  id: string
  catalogName: string
  position: [number, number, number]
}

interface SceneState {
  parts: PlacedPart[]
  selectedId: string | null
  /** id of the part currently being dragged, or null. OrbitControls is
   *  disabled while this is set — it listens on the raw canvas DOM element,
   *  not through R3F's event system, so stopPropagation() alone can't
   *  stop it from also rotating the camera during a part drag. */
  draggingId: string | null
  movePart: (id: string, position: [number, number, number]) => void
  selectPart: (id: string | null) => void
  setDragging: (id: string | null) => void
}

export const useSceneStore = create<SceneState>((set) => ({
  parts: [{ id: 'r1', catalogName: 'resistor-220ohm', position: [0, 0.15, 0] }],
  selectedId: null,
  draggingId: null,
  movePart: (id, position) =>
    set((state) => ({
      parts: state.parts.map((p) => (p.id === id ? { ...p, position } : p)),
    })),
  selectPart: (id) => set({ selectedId: id }),
  setDragging: (id) => set({ draggingId: id }),
}))
