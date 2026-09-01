export interface Pin {
  id: string
  /** position relative to the part's own origin, in breadboard-hole units */
  x: number
  z: number
  label?: string
}

/** `type` selects the geometry generator + sim behavior module.
 *  `name` is the concrete instance with its own specs. */
export interface CatalogEntry {
  name: string
  type: string
  description: string
  tags: string[]
  pins: Pin[]
  specs: Record<string, number | string | boolean>
}
