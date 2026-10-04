import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { readyCount } from '../curriculum'
import { Category, Topic } from '../curriculum/types'
import { NodeArt } from '../ui/NodeArt'
import { C, S } from '../ui/theme'

export function CategoryScreen({ category, onTopic }: { category: Category; onTopic: (t: Topic) => void }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.tagline}>{category.tagline}</Text>
        {category.topics.map((t) => (
          <Pressable key={t.id} style={styles.cell} onPress={() => onTopic(t)}>
            <View style={styles.card}>
              <NodeArt seed={t.id} />
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={2}>
                  {t.title}
                </Text>
                <Text style={styles.count}>
                  {readyCount(t)}/{t.entries.length}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: S.pad - 6 },
  tagline: { width: '100%', color: C.dim, fontSize: 15, paddingHorizontal: 6, paddingBottom: 10 },
  cell: { width: '50%', padding: 6 },
  card: { borderRadius: S.radius, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' },
  body: { padding: 14, minHeight: 92, justifyContent: 'space-between' },
  name: { color: C.text, fontSize: 17, fontWeight: '600' },
  count: { color: C.dim, fontSize: 14, marginTop: 10 },
})
