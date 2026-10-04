import React, { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CatalogEntry } from '../core/catalog'
import { buildModel } from '../models'
import { FOV, fitObject, Orbit } from '../scene/orbit'
import { createStage } from '../scene/stage'
import { Viewport } from '../scene/Viewport'
import { SpecTable } from '../ui/SpecTable'
import { C, S } from '../ui/theme'

/** One part on a turntable: drag to inspect, specs below. */
export function PartViewer({ part, onBack }: { part: CatalogEntry; onBack: () => void }) {
  const insets = useSafeAreaInsets()
  const { scene, orbit } = useMemo(() => {
    const model = buildModel(part)
    const fit = fitObject(model, FOV)
    const s = createStage({ span: fit.radius })
    s.add(model)
    if (part.type === 'led') model.userData.setGlow(0.35)
    const o = new Orbit({ minRadius: fit.radius * 0.3, maxRadius: fit.radius * 8, minPolar: 0.05, maxPolar: Math.PI - 0.05 })
    o.polar = 1.05
    o.frame(fit.center, fit.radius * 0.8)
    return { scene: s, orbit: o }
  }, [part])

  return (
    <View style={styles.fill}>
      <View style={styles.stage}>
        <Viewport scene={scene} orbit={orbit} autoRotate />
        <Pressable onPress={onBack} hitSlop={12} style={[styles.back, { top: insets.top + 8 }]}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.sheet} contentContainerStyle={{ padding: S.pad, paddingBottom: insets.bottom + 16 }}>
        <Text style={styles.title}>{part.title}</Text>
        <Text style={styles.desc}>{part.description}</Text>
        <SpecTable entry={part} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  stage: { flex: 1.3 },
  back: {
    position: 'absolute',
    left: 12,
    backgroundColor: 'rgba(31,34,41,0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  backText: { color: C.text, fontSize: 15 },
  sheet: {
    flex: 1,
    backgroundColor: C.card,
    borderTopLeftRadius: S.radius,
    borderTopRightRadius: S.radius,
  },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
  desc: { color: C.dim, fontSize: 14, marginTop: 4, marginBottom: 12 },
})
