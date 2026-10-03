import React, { useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { CatalogEntry } from './src/core/catalog'
import { Lesson } from './src/lessons/types'
import { BenchScreen } from './src/screens/BenchScreen'
import { LearnScreen } from './src/screens/LearnScreen'
import { LessonScreen } from './src/screens/LessonScreen'
import { PartsScreen } from './src/screens/PartsScreen'
import { PartViewer } from './src/screens/PartViewer'
import { C } from './src/ui/theme'

type Tab = 'bench' | 'learn' | 'parts'

const TAB_LABELS: Record<Tab, string> = { bench: 'Bench', learn: 'Learn', parts: 'Parts' }

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <Root />
    </SafeAreaProvider>
  )
}

// One 3D viewport is mounted at a time; switching unmounts the other's renderer.
function Root() {
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('bench')
  const [open, setOpen] = useState<CatalogEntry | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)

  if (open) return <PartViewer part={open} onBack={() => setOpen(null)} />
  if (lesson) return <LessonScreen lesson={lesson} onBack={() => setLesson(null)} />

  return (
    <View style={styles.fill}>
      <View style={styles.fill}>
        {tab === 'bench' && <BenchScreen />}
        {tab === 'learn' && <LearnScreen onOpen={setLesson} />}
        {tab === 'parts' && <PartsScreen onOpen={setOpen} />}
      </View>
      <View style={[styles.tabs, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <Pressable key={t} style={styles.tab} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabOn]}>{TAB_LABELS[t]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  tabs: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.cardBorder,
    paddingTop: 10,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabText: { color: C.dim, fontSize: 15, fontWeight: '600' },
  tabOn: { color: C.accent },
})
