import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as THREE from 'three/webgpu'
import { Lesson, Params, Readout, initialParams } from '../lessons/types'
import { Orbit } from '../scene/orbit'
import { Viewport } from '../scene/Viewport'
import { Slider } from '../ui/Slider'
import { C, S } from '../ui/theme'

const TONE = { ok: C.ok, warn: C.warn, bad: C.bad }

export function LessonScreen({ lesson, onBack }: { lesson: Lesson; onBack: () => void }) {
  const insets = useSafeAreaInsets()
  const [params, setParams] = useState<Params>(() => initialParams(lesson))
  const live = useRef(params)
  live.current = params

  const { stage, orbit } = useMemo(() => {
    const s = lesson.build()
    const o = new Orbit({ minRadius: s.view.radius * 0.015, maxRadius: s.view.radius * 8, minPolar: 0.05, maxPolar: Math.PI - 0.05 })
    o.frame(new THREE.Vector3(...s.view.center), s.view.radius)
    o.polar = s.view.polar ?? o.polar
    o.azimuth = s.view.azimuth ?? o.azimuth
    return { stage: s, orbit: o }
  }, [lesson])

  // Readouts can depend on animated state (e.g. a charging capacitor), so poll them.
  const [readouts, setReadouts] = useState<Readout[]>(() => stage.readouts(params))
  useEffect(() => {
    const id = setInterval(() => setReadouts(stage.readouts(live.current)), 200)
    return () => clearInterval(id)
  }, [stage])

  const set = (key: string, value: number | string) => {
    const nextParams = { ...live.current, [key]: value }
    live.current = nextParams
    setParams(nextParams)
    setReadouts(stage.readouts(nextParams))
  }

  const formula = typeof lesson.formula === 'function' ? lesson.formula(params) : lesson.formula

  return (
    <View style={styles.fill}>
      <View style={styles.stage}>
        <Viewport scene={stage.scene} orbit={orbit} onFrame={(dt) => stage.frame(dt, live.current)} />
        <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={onBack} hitSlop={12} style={styles.pill}>
            <Text style={styles.back}>‹ Learn</Text>
          </Pressable>
        </View>
        {lesson.legend && (
          <View style={[styles.legend, { top: insets.top + 8 }]} pointerEvents="none">
            {lesson.legend.map((item) => (
              <View key={item.label} style={styles.legendRow}>
                {item.shape === 'dot' ? (
                  <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                ) : (
                  <Text style={[styles.legendArrow, { color: item.color }]}>{item.shape === 'arrow-left' ? '←' : '→'}</Text>
                )}
                <Text style={styles.legendText}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.readouts} pointerEvents="none">
          {readouts.map((r) => (
            <View key={r.label} style={styles.readout}>
              <Text style={styles.rLabel}>{r.label}</Text>
              <Text style={[styles.rValue, r.tone && { color: TONE[r.tone] }]}>{r.value}</Text>
            </View>
          ))}
        </View>
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={styles.title}>{lesson.title}</Text>
        <Text style={styles.tagline}>{lesson.tagline}</Text>
        <View style={styles.formulaBox}>
          <Text style={styles.formula}>{formula}</Text>
        </View>

        {lesson.controls.map((c) =>
          c.kind === 'choice' ? (
            <View key={c.key} style={styles.chips}>
              {c.options.map((o) => {
                const on = params[c.key] === o.value
                return (
                  <Pressable key={o.value} onPress={() => set(c.key, o.value)} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          ) : (
            <View key={c.key} style={styles.control}>
              <View style={styles.controlHead}>
                <Text style={styles.cLabel}>{c.label}</Text>
                <Text style={styles.cValue}>{c.format(Number(params[c.key]))}</Text>
              </View>
              <Slider
                value={Number(params[c.key])}
                min={c.min}
                max={c.max}
                step={c.step}
                log={c.log}
                onChange={(v) => set(c.key, v)}
              />
            </View>
          ),
        )}

        <View style={styles.points}>
          {lesson.points.map((p, i) => (
            <View key={i} style={styles.point}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.pointText}>{p}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  stage: { flex: 1.2 },
  top: { position: 'absolute', left: 12, right: 12, flexDirection: 'row' },
  pill: { backgroundColor: 'rgba(31,34,41,0.85)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  back: { color: C.text, fontSize: 15 },
  legend: {
    position: 'absolute',
    right: 10,
    backgroundColor: 'rgba(31,34,41,0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
    gap: 3,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5, marginHorizontal: 2 },
  legendArrow: { fontSize: 13, fontWeight: '700', width: 13, textAlign: 'center' },
  legendText: { color: C.text, fontSize: 11 },
  readouts: { position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  readout: {
    backgroundColor: 'rgba(31,34,41,0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  rLabel: { color: C.dim, fontSize: 11 },
  rValue: { color: C.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sheet: { flex: 1, backgroundColor: C.card, borderTopLeftRadius: S.radius, borderTopRightRadius: S.radius },
  sheetBody: { padding: S.pad },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
  tagline: { color: C.dim, fontSize: 14, marginTop: 2 },
  formulaBox: { backgroundColor: '#171a20', borderRadius: 10, paddingVertical: 10, marginVertical: 12, alignItems: 'center' },
  formula: { color: C.accent, fontSize: 20, fontWeight: '600', fontFamily: 'Menlo' },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.cardBorder },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text, fontSize: 14 },
  chipTextOn: { color: '#0b1220', fontWeight: '600' },
  control: { marginBottom: 4 },
  controlHead: { flexDirection: 'row', justifyContent: 'space-between' },
  cLabel: { color: C.dim, fontSize: 14 },
  cValue: { color: C.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  points: { marginTop: 10, gap: 8 },
  point: { flexDirection: 'row', gap: 8 },
  bullet: { color: C.accent, fontSize: 15, lineHeight: 21 },
  pointText: { color: C.text, fontSize: 15, lineHeight: 21, flex: 1 },
})
