// A half-size breadboard: two power rails (+ / -) running the full length,
// and terminal strips split into a top half (rows a-e) and bottom half
// (rows f-j) around a center gap, each column of 5 holes electrically
// joined within its half.
//
// Simplification, documented in DESIGN.md: each rail is modeled as ONE
// continuous net (no mid-board split), which real breadboards sometimes
// have. Close enough for a teaching tool.

export interface Hole {
  row: string // '+' | '-' | 'a'..'j'
  col: number // 1-based column index
}

export const TOP_ROWS = ['a', 'b', 'c', 'd', 'e']
export const BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j']
export const RAIL_ROWS = ['+', '-']

/** Which electrical bus a hole belongs to. Two holes with the same netKey
 *  are internally connected by the board itself (before any wires/parts). */
export function netKeyOf(hole: Hole): string {
  if (hole.row === '+' || hole.row === '-') {
    return `rail-${hole.row}`
  }
  const half = TOP_ROWS.includes(hole.row) ? 'top' : 'bottom'
  return `strip-${half}-${hole.col}`
}

export function generateHoles(columns: number): Hole[] {
  const holes: Hole[] = []
  for (const row of RAIL_ROWS) {
    for (let col = 1; col <= columns; col++) holes.push({ row, col })
  }
  for (const row of [...TOP_ROWS, ...BOTTOM_ROWS]) {
    for (let col = 1; col <= columns; col++) holes.push({ row, col })
  }
  return holes
}

// --- Union-find over holes/pins/wires, resolving the final electrical nets ---

export class NetResolver {
  private parent = new Map<string, string>()

  private find(key: string): string {
    if (!this.parent.has(key)) this.parent.set(key, key)
    let root = key
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    // path compression
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

/** Builds a NetResolver from the board's own bus connectivity, so holes
 *  sharing a rail/strip are pre-unioned before any parts/wires are added. */
export function buildBoardResolver(columns: number): NetResolver {
  const resolver = new NetResolver()
  for (const hole of generateHoles(columns)) {
    const holeKey = `${hole.row}${hole.col}`
    resolver.union(holeKey, netKeyOf(hole))
  }
  return resolver
}
