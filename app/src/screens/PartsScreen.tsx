import React from 'react'
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CATALOG, CATEGORIES, CatalogEntry } from '../core/catalog'
import { C, S } from '../ui/theme'

const SECTIONS = CATEGORIES.map((title) => ({ title, data: CATALOG.filter((e) => e.category === title) })).filter(
  (s) => s.data.length > 0,
)

export function PartsScreen({ onOpen }: { onOpen: (e: CatalogEntry) => void }) {
  const insets = useSafeAreaInsets()
  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      sections={SECTIONS}
      keyExtractor={(e) => e.name}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.hint}>{CATALOG.length} parts, each a 3D model built from its specs</Text>
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title.toUpperCase()}</Text>}
      renderItem={({ item }) => (
        <Pressable onPress={() => onOpen(item)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.flex}>
            <Text style={styles.name}>{item.title}</Text>
            <Text style={styles.desc} numberOfLines={2}>
              {item.description}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
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
    gap: 10,
  },
  pressed: { opacity: 0.6 },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  desc: { color: C.dim, fontSize: 13, marginTop: 2 },
  chevron: { color: C.dim, fontSize: 24 },
})
