import React, { useMemo, useRef } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { C } from './theme'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  log?: boolean
  onChange: (v: number) => void
}

const THUMB = 26

export function Slider({ value, min, max, step, log, onChange }: Props) {
  const width = useRef(1)
  const props = useRef({ min, max, step, log, onChange })
  props.current = { min, max, step, log, onChange }

  const toT = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min))

  const responder = useMemo(() => {
    const set = (x: number) => {
      const p = props.current
      const t = Math.min(1, Math.max(0, (x - THUMB / 2) / (width.current - THUMB)))
      let v = p.log ? p.min * (p.max / p.min) ** t : p.min + t * (p.max - p.min)
      if (p.step) v = Math.round(v / p.step) * p.step
      p.onChange(+v.toFixed(6))
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
      onPanResponderMove: (e) => set(e.nativeEvent.locationX),
    })
  }, [])

  const t = Math.min(1, Math.max(0, toT(value)))
  return (
    <View style={styles.hit} onLayout={(e) => (width.current = e.nativeEvent.layout.width)} {...responder.panHandlers}>
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: `${t * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${t * 100}%`, marginLeft: -t * THUMB }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  hit: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: C.cardBorder, marginHorizontal: THUMB / 2, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: C.accent },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#f4f6fa',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
})
