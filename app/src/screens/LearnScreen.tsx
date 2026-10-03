import React from 'react'
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { UNITS } from '../lessons'
import { Lesson } from '../lessons/types'
import { C, S } from '../ui/theme'

const SECTIONS = UNITS.map((u) => ({ title: u.title, data: u.lessons }))

export function LearnScreen({ onOpen }: { onOpen: (l: Lesson) => void }) {
  const insets = useSafeAreaInsets()
  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      sections={SECTIONS}
      keyExtractor={(l) => l.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Learn</Text>
          <Text style={styles.hint}>The physics behind the parts, as live 3D models you can change</Text>
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title.toUpperCase()}</Text>}
      renderItem={({ item, index }) => (
        <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Text style={styles.num}>{index + 1}</Text>
          <View style={styles.flex}>
            <Text style={styles.name}>{item.title}</Text>
            <Text style={styles.desc}>{item.tagline}</Text>
          </View>
          <Text style={styles.formula} numberOfLines={1}>
            {typeof item.formula === 'string' ? item.formula : ''}
          </Text>
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 24 },
  flex: { flex: 1 },
  header: { paddingHorizontal: S.pad, marginBottom: 8 },
  title: { color: C.text, fontSize: 28, fontWeight: '700' },
  hint: { color: C.dim, fontSize: 12, marginTop: 2 },
  section: { color: C.dim, fontSize: 12, fontWeight: '600', letterSpacing: 0.8, marginTop: 18, marginBottom: 6, marginHorizontal: S.pad },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginBottom: 6,
    padding: 14,
    backgroundColor: C.card,
    borderRadius: 12,
    gap: 12,
  },
  pressed: { opacity: 0.6 },
  num: { color: C.accent, fontSize: 18, fontWeight: '700', width: 22, textAlign: 'center' },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  desc: { color: C.dim, fontSize: 13, marginTop: 2 },
  formula: { color: C.dim, fontSize: 12, fontFamily: 'Menlo', maxWidth: 110 },
})
