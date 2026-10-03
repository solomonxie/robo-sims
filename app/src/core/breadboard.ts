// Half-size breadboard, 30 columns. Units: 1 = one hole pitch (2.54 mm).
// Strips a-e / f-j: each column's 5 holes are joined within its half.
// Rails on both edges, holes in groups of 5. Each rail is modeled as ONE
// continuous net (real boards sometimes split mid-board).

export const COLUMNS = 30
export const TOP_ROWS = ['a', 'b', 'c', 'd', 'e']
export const BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j']
export const RAIL_ROWS = ['top-', 'top+', 'bottom+', 'bottom-']

export interface Hole {
  row: string
  col: number // 1-based
}

const ROW_Z: Record<string, number> = {
  'top-': -9.5,
  'top+': -8.5,
  a: -5.5,
  b: -4.5,
  c: -3.5,
  d: -2.5,
  e: -1.5,
  f: 1.5,
  g: 2.5,
  h: 3.5,
  i: 4.5,
  j: 5.5,
  'bottom+': 8.5,
  'bottom-': 9.5,
}

export const BOARD = { width: COLUMNS + 3, depth: 22, height: 3.4 }

export const isRail = (row: string) => RAIL_ROWS.includes(row)

/** Rails skip every 6th column, giving the familiar groups of five. */
export const railHasColumn = (col: number) => (col - 1) % 6 !== 5

export function holeKey(hole: Hole): string {
  return `${hole.row}${hole.col}`
}

/** Board-local (x, z) of a hole, board centered on the origin. */
export function holePosition(hole: Hole): { x: number; z: number } {
  const z = ROW_Z[hole.row]
  if (z === undefined) throw new Error(`unknown row ${hole.row}`)
  return { x: hole.col - (COLUMNS + 1) / 2, z }
}

/** The bus a hole belongs to: same key ⇒ joined by the board itself. */
export function netKeyOf(hole: Hole): string {
  if (isRail(hole.row)) return `rail-${hole.row}`
  const half = TOP_ROWS.includes(hole.row) ? 'top' : 'bottom'
  return `strip-${half}-${hole.col}`
}

export function generateHoles(columns = COLUMNS): Hole[] {
  const holes: Hole[] = []
  for (const row of [...RAIL_ROWS, ...TOP_ROWS, ...BOTTOM_ROWS]) {
    for (let col = 1; col <= columns; col++) {
      if (isRail(row) && !railHasColumn(col)) continue
      holes.push({ row, col })
    }
  }
  return holes
}

export class NetResolver {
  private parent = new Map<string, string>()

  private find(key: string): string {
    if (!this.parent.has(key)) this.parent.set(key, key)
    let root = key
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let node = key
    while (this.parent.get(node) !== root) {
      const next = this.parent.get(node)!
      this.parent.set(node, root)
      node = next
    }
    return root
  }

  union(a: string, b: string): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent.set(rootA, rootB)
  }

  netOf(key: string): string {
    return this.find(key)
  }
}

/** Holes sharing a rail/strip pre-unioned, before any parts or wires. */
export function buildBoardResolver(columns = COLUMNS): NetResolver {
  const resolver = new NetResolver()
  for (const hole of generateHoles(columns)) resolver.union(holeKey(hole), netKeyOf(hole))
  return resolver
}
