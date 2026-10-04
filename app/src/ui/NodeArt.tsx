import React, { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { C } from './theme'

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 4294967296, 7)

// Deterministic mini node-graph, a distinct tree per id.
export function NodeArt({ seed, height = 110 }: { seed: string; height?: number }) {
  const { nodes, edges } = useMemo(() => {
    let h = hash(seed)
    const rnd = () => ((h = (h * 1664525 + 1013904223) % 4294967296) / 4294967296)
    const levels = 2 + Math.floor(rnd() * 2)
    const pts: { x: number; y: number; hot: boolean }[] = [{ x: 0.5, y: 0.1, hot: false }]
    const links: [number, number][] = []
    let prev = [0]
    for (let l = 1; l <= levels; l++) {
      const count = Math.min(prev.length * (1 + Math.floor(rnd() * 2)), 5)
      const next: number[] = []
      for (let i = 0; i < count; i++) {
        pts.push({ x: (i + 0.5) / count, y: 0.1 + (0.8 * l) / levels, hot: rnd() < 0.25 })
        next.push(pts.length - 1)
        links.push([prev[Math.min(prev.length - 1, Math.floor((i * prev.length) / count))], pts.length - 1])
      }
      prev = next
    }
    return { nodes: pts, edges: links }
  }, [seed])

  return (
    <View style={[styles.box, { height }]}>
      <View style={styles.inner}>
        {edges.map(([a, b], i) => (
          <Edge key={i} a={nodes[a]} b={nodes[b]} />
        ))}
        {nodes.map((n, i) => (
          <View key={i} style={[styles.node, { left: `${n.x * 100}%`, top: `${n.y * 100}%` }, n.hot && styles.hot]} />
        ))}
      </View>
    </View>
  )
}

type P = { x: number; y: number }
// Edges drawn as thin rotated views; the box is laid out in percentages, so use fixed reference size.
const W = 150
function Edge({ a, b }: { a: P; b: P }) {
  const H = 100
  const dx = (b.x - a.x) * W
  const dy = (b.y - a.y) * H
  const len = Math.hypot(dx, dy)
  const cx = ((a.x + b.x) / 2) * W
  const cy = ((a.y + b.y) / 2) * H
  return (
    <View
      style={[
        styles.edge,
        { width: len, left: `50%`, top: `${(cy / H) * 100}%`, marginLeft: cx - W / 2 - len / 2, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  box: { backgroundColor: C.well, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  inner: { width: W, height: 100 },
  node: { position: 'absolute', width: 12, height: 12, marginLeft: -6, marginTop: -6, borderRadius: 6, borderWidth: 1.5, borderColor: '#6b707c', backgroundColor: C.well },
  hot: { borderColor: C.accent },
  edge: { position: 'absolute', height: 1, backgroundColor: '#3a3e49' },
})
