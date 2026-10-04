import React, { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as THREE from 'three/webgpu'
import { entry } from '../core/catalog'
import { LedReading } from '../core/circuit'
import { createBench, PlacedPart } from '../scene/bench'
import { Orbit } from '../scene/orbit'
import { XRAY_LEGEND } from '../scene/xray'
import { Viewport } from '../scene/Viewport'
import { SpecTable } from '../ui/SpecTable'
import { C, S } from '../ui/theme'

const RESISTORS = ['resistor-220', 'resistor-1k', 'resistor-10k']

export function BenchScreen() {
  const insets = useSafeAreaInsets()
  const bench = useMemo(createBench, [])
  const orbit = useMemo(() => {
    const o = new Orbit()
    o.frame(new THREE.Vector3(0, 0, 0), 62)
    return o
  }, [])
  const outline = useRef<THREE.BoxHelper | null>(null)
  const [selected, setSelected] = useState<PlacedPart | null>(null)
  const [reading, setReading] = useState<LedReading>(bench.reading)
  const [version, setVersion] = useState(0)
  const [xray, setXray] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const toggleXray = () => {
    bench.setXray(!xray)
    setXray(!xray)
    setVersion((v) => v + 1)
  }

  const select = (part: PlacedPart | null) => {
    if (outline.current) bench.scene.remove(outline.current)
    outline.current = null
    if (part && part.entry.type !== 'breadboard') {
      outline.current = new THREE.BoxHelper(part.object, C.accent)
      bench.scene.add(outline.current)
    }
    setSelected(part)
    setExpanded(false)
    setVersion((v) => v + 1)
  }

  const onTap = (obj: THREE.Object3D | null) => {
    select(obj ? bench.parts.find((p) => p.id === obj.userData.partId) ?? null : null)
  }

  const swapResistor = (name: string) => {
    setReading(bench.setResistor(name))
    select(bench.parts.find((p) => p.id === 'R1')!)
  }

  const inLoop = selected && ['R1', 'D1', 'BT1'].includes(selected.id)

  return (
    <View style={styles.fill}>
      <Viewport scene={bench.scene} orbit={orbit} version={version} onTap={onTap} onFrame={xray ? bench.tick : undefined} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="none">
        <Text style={styles.title}>Bench</Text>
        <Text style={styles.hint}>One finger to pan · two fingers to rotate · pinch to zoom · tap a part for info</Text>
      </View>

      <View style={[styles.status, { top: insets.top + 64 }]} pointerEvents="none">
        <View style={[styles.dot, { backgroundColor: statusColor(reading) }]} />
        <Text style={styles.statusText}>
          LED {reading.status === 'over-current' ? 'over-driven' : reading.status} · {reading.currentMA.toFixed(1)} mA
        </Text>
      </View>

      <View style={[styles.tools, { top: insets.top + 8 }]}>
        <Pressable onPress={toggleXray} style={[styles.chip, xray && styles.chipOn]}>
          <Text style={[styles.chipText, xray && styles.chipTextOn]}>X-ray</Text>
        </Pressable>
      </View>

      {xray && (
        <View style={[styles.legend, { top: insets.top + 108 }]} pointerEvents="none">
          {XRAY_LEGEND.map((item) => (
            <View key={item.label} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: item.color }]} />
              <Text style={styles.statusText}>{item.label}</Text>
            </View>
          ))}
          <Text style={styles.hint}>Dots: current, + to −</Text>
        </View>
      )}

      {selected && !expanded && (
        <Pressable style={styles.tip} onPress={() => setExpanded(true)}>
          <Text style={styles.tipText} numberOfLines={1}>
            <Text style={styles.ref}>{selected.id} </Text>
            {selected.entry.title}
          </Text>
          <Text style={styles.tipMore}>More ▴</Text>
          <Pressable onPress={() => select(null)} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </Pressable>
      )}

      {selected && expanded && (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>
                <Text style={styles.ref}>{selected.id} </Text>
                {selected.entry.title}
              </Text>
              <Text style={styles.cardDesc}>{selected.entry.description}</Text>
            </View>
            <Pressable onPress={() => select(null)} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.cardBody}>
            {inLoop && (
              <View style={styles.loop}>
                <Text style={styles.loopTitle}>LED loop: 18650 → R1 → D1 → GND</Text>
                <Text style={[styles.loopText, { color: statusColor(reading) }]}>{reading.reason}</Text>
                {selected.id === 'R1' && (
                  <View style={styles.chips}>
                    {RESISTORS.map((name) => {
                      const on = selected.entry.name === name
                      return (
                        <Pressable key={name} onPress={() => swapResistor(name)} style={[styles.chip, on && styles.chipOn]}>
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{entry(name).title.replace(' resistor', '')}</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                )}
              </View>
            )}
            {selected.holes.length > 0 && (
              <View style={styles.holes}>
                <Text style={styles.key}>In holes</Text>
                <Text style={styles.val}>{selected.holes.join(' · ')}</Text>
              </View>
            )}
            <SpecTable entry={selected.entry} />
          </ScrollView>
        </View>
      )}
    </View>
  )
}

function statusColor(r: LedReading) {
  return r.status === 'lit' ? C.ok : r.status === 'off' ? C.dim : C.bad
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  header: { position: 'absolute', left: S.pad, right: S.pad },
  title: { color: C.text, fontSize: 28, fontWeight: '700' },
  hint: { color: C.dim, fontSize: 12, marginTop: 2 },
  status: {
    position: 'absolute',
    left: S.pad,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31,34,41,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: C.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  tools: { position: 'absolute', right: S.pad },
  legend: {
    position: 'absolute',
    left: S.pad,
    backgroundColor: 'rgba(31,34,41,0.85)',
    padding: 10,
    borderRadius: 12,
    gap: 4,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tip: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tipText: { color: C.text, fontSize: 14, maxWidth: 220 },
  tipMore: { color: C.accent, fontSize: 13 },
  card: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    maxHeight: '48%',
    backgroundColor: C.card,
    borderRadius: S.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
    padding: S.pad,
  },
  cardHead: { flexDirection: 'row', gap: 12 },
  cardTitle: { color: C.text, fontSize: 18, fontWeight: '600' },
  ref: { color: C.accent },
  cardDesc: { color: C.dim, fontSize: 13, marginTop: 2 },
  close: { color: C.dim, fontSize: 18 },
  cardBody: { marginTop: 10 },
  loop: { backgroundColor: '#171a20', borderRadius: 10, padding: 10, marginBottom: 8 },
  loopTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  loopText: { fontSize: 13, marginTop: 4, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.cardBorder },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text, fontSize: 13 },
  chipTextOn: { color: '#0b1220', fontWeight: '600' },
  holes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.cardBorder,
  },
  key: { color: C.dim, fontSize: 14 },
  val: { color: C.text, fontSize: 14 },
})
