import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LEARN, PRACTICE, SECTIONS, lessonCount, search, topicCount } from '../curriculum'
import { Category, Topic } from '../curriculum/types'
import { NodeArt } from '../ui/NodeArt'
import { C, S } from '../ui/theme'
import { Results } from './Results'

interface Props {
  onCategory: (c: Category) => void
  onTopic: (c: Category, t: Topic) => void
  onBench: () => void
  onParts: () => void
}

export function HomeScreen({ onCategory, onTopic, onBench, onParts }: Props) {
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState('')
  const hits = search(q)
  const start = LEARN[0].topics[0]

  return (
    <ScrollView style={styles.fill} contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Robo Sims</Text>
      <View style={styles.search}>
        <Text style={styles.glass}>⌕</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search lessons, topics, parts"
          placeholderTextColor={C.dim}
          style={styles.input}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {q.trim() ? (
        <Results hits={hits} onTopic={onTopic} />
      ) : (
        <>
          <Pressable style={styles.hero} onPress={() => onTopic(LEARN[0], start)}>
            <NodeArt seed="hero" height={120} />
            <View style={styles.heroRow}>
              <View style={styles.play}>
                <Text style={styles.playGlyph}>▶</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>START HERE</Text>
                <Text style={styles.heroTitle}>{start.title}</Text>
                <Text style={styles.dim}>{LEARN[0].title} · live 3D lesson</Text>
              </View>
            </View>
          </Pressable>

          {SECTIONS.map((sec) => (
            <View key={sec.title}>
              <Text style={styles.section}>{sec.title}</Text>
              <View style={styles.grid}>
                {sec.categories.map((c) => (
                  <Pressable key={c.id} style={({ pressed }) => [styles.tile, pressed && styles.pressed]} onPress={() => onCategory(c)}>
                    <View style={styles.tileCard}>
                      <Text style={styles.icon}>{c.icon}</Text>
                      <Text style={styles.tileTitle} numberOfLines={2}>
                        {c.title}
                      </Text>
                      <Text style={styles.dim}>{topicCount(c)} topics</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          <Text style={styles.section}>Practice</Text>
          {PRACTICE.map((c) => (
            <Pressable key={c.id} style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => onCategory(c)}>
              <Text style={styles.rowIcon}>{c.icon}</Text>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{c.title}</Text>
                <Text style={styles.dim}>
                  {c.tagline} · {lessonCount(c)} steps
                </Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))}

          <Text style={styles.section}>Build</Text>
          <View style={styles.build}>
            <Pressable style={styles.buildCard} onPress={onBench}>
              <View style={styles.buildArt}>
                <Text style={styles.buildGlyph}>＋</Text>
              </View>
              <Text style={[styles.rowTitle, styles.pad]}>Open the bench</Text>
              <Text style={[styles.dim, styles.pad]}>breadboard + parts</Text>
            </Pressable>
            <Pressable style={styles.buildCard} onPress={onParts}>
              <View style={styles.buildArt}>
                <Text style={styles.buildGlyph}>▤</Text>
              </View>
              <Text style={[styles.rowTitle, styles.pad]}>Parts library</Text>
              <Text style={[styles.dim, styles.pad]}>browse in 3D</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  content: { paddingBottom: 28 },
  pad: { paddingHorizontal: 14 },
  title: { color: C.text, fontSize: 34, fontWeight: '700', paddingHorizontal: S.pad, marginBottom: 12 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: S.pad,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.cardBorder,
    gap: 8,
  },
  glass: { color: C.dim, fontSize: 20 },
  input: { flex: 1, color: C.text, fontSize: 16 },
  hero: { marginHorizontal: S.pad, marginTop: 16, borderRadius: S.radius, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { color: C.bg, fontSize: 16, marginLeft: 2 },
  eyebrow: { color: C.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  heroTitle: { color: C.text, fontSize: 21, fontWeight: '600' },
  dim: { color: C.dim, fontSize: 14, marginTop: 2 },
  section: { color: C.text, fontSize: 26, fontWeight: '700', marginHorizontal: S.pad, marginTop: 30, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: S.pad - 6 },
  tile: { width: '50%', padding: 6 },
  tileCard: { flex: 1, minHeight: 124, padding: 16, borderRadius: S.radius, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder },
  pressed: { opacity: 0.6 },
  icon: { color: C.accent, fontSize: 26 },
  tileTitle: { color: C.text, fontSize: 18, fontWeight: '600', marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: S.pad, marginBottom: 10, padding: 14, borderRadius: S.radius, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder },
  rowIcon: { color: C.accent, fontSize: 26, width: 34, textAlign: 'center' },
  rowTitle: { color: C.text, fontSize: 18, fontWeight: '600' },
  chev: { color: C.dim, fontSize: 26 },
  build: { flexDirection: 'row', gap: 12, paddingHorizontal: S.pad },
  buildCard: { flex: 1, borderRadius: S.radius, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden', paddingBottom: 14 },
  buildArt: { height: 90, backgroundColor: C.well, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  buildGlyph: { color: C.dim, fontSize: 40 },
})
