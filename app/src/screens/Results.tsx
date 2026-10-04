import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Hit } from '../curriculum'
import { Topic, Category } from '../curriculum/types'
import { C, S } from '../ui/theme'

export function Results({ hits, onTopic }: { hits: Hit[]; onTopic: (c: Category, t: Topic) => void }) {
  if (!hits.length) return <Text style={styles.empty}>No matches</Text>
  return (
    <View style={styles.wrap}>
      {hits.map((h, i) => (
        <Pressable key={i} style={styles.row} onPress={() => onTopic(h.category, h.topic)}>
          <Text style={styles.title}>{h.entry ? h.entry.title : h.topic.title}</Text>
          <Text style={styles.sub}>
            {h.category.title} · {h.entry ? h.topic.title : 'topic'}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, marginHorizontal: S.pad, borderRadius: S.radius, backgroundColor: C.card, overflow: 'hidden' },
  row: { padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.cardBorder },
  title: { color: C.text, fontSize: 16, fontWeight: '600' },
  sub: { color: C.dim, fontSize: 13, marginTop: 2 },
  empty: { color: C.dim, textAlign: 'center', marginTop: 40 },
})
