import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { readyCount } from '../curriculum'
import { KIND_LABEL, Topic } from '../curriculum/types'
import { Lesson } from '../lessons/types'
import { NodeArt } from '../ui/NodeArt'
import { C, S } from '../ui/theme'

export function TopicScreen({ topic, onLesson }: { topic: Topic; onLesson: (l: Lesson) => void }) {
  const insets = useSafeAreaInsets()
  const first = topic.entries.findIndex((e) => e.lesson)
  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={styles.art}>
          <NodeArt seed={topic.id} height={170} />
        </View>
        <Text style={styles.tagline}>{topic.tagline}</Text>
        <View style={styles.head}>
          <Text style={styles.eyebrow}>LESSONS</Text>
          <Text style={styles.eyebrow}>
            {readyCount(topic)}/{topic.entries.length} ready
          </Text>
        </View>
        <View style={styles.list}>
          {topic.entries.map((e, i) => (
            <Pressable
              key={e.id}
              disabled={!e.lesson}
              onPress={() => e.lesson && onLesson(e.lesson)}
              style={[styles.row, i > 0 && styles.sep, !e.lesson && styles.soon]}>
              <View style={[styles.ring, i === first && styles.ringOn]} />
              <View style={styles.flex}>
                <Text style={[styles.name, i === first && styles.nameOn]}>{e.title}</Text>
                <Text style={styles.sub}>
                  {KIND_LABEL[e.kind]} · {e.min} min{e.lesson ? '' : ' · soon'}
                </Text>
              </View>
              {e.lesson && <Text style={styles.chev}>{e.kind === 'anim' ? '▷' : '›'}</Text>}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  art: { marginHorizontal: S.pad, marginTop: 8, borderRadius: S.radius, overflow: 'hidden', borderWidth: 1, borderColor: C.cardBorder },
  tagline: { color: C.dim, fontSize: 16, lineHeight: 22, margin: S.pad },
  head: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: S.pad + 8, marginTop: 6, marginBottom: 8 },
  eyebrow: { color: C.dim, fontSize: 13, fontWeight: '600', letterSpacing: 1.2 },
  list: { marginHorizontal: S.pad, borderRadius: S.radius, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 13 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.cardBorder },
  soon: { opacity: 0.45 },
  ring: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#555a66' },
  ringOn: { borderColor: C.accent },
  name: { color: C.text, fontSize: 17 },
  nameOn: { fontWeight: '700' },
  sub: { color: C.dim, fontSize: 14, marginTop: 2 },
  chev: { color: C.accent, fontSize: 24 },
})
