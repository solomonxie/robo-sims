import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { CatalogEntry } from '../core/catalog'
import { C } from './theme'

const LABELS: Record<string, string> = {
  ohms: 'Resistance',
  watts: 'Power rating',
  tolerance: 'Tolerance',
  forwardVoltageV: 'Forward voltage',
  maxCurrentMA: 'Max current',
  farads: 'Capacitance',
  volts: 'Voltage',
  code: 'Marking',
  rangeCm: 'Range',
  frequencyKHz: 'Frequency',
  accuracyC: 'Accuracy',
  logicV: 'Logic level',
  clockMHz: 'Clock',
  gpio: 'GPIO',
  maxCurrentA: 'Max current',
  maxVolts: 'Max motor voltage',
  capacityMah: 'Capacity',
  ratio: 'Gear ratio',
  rpm: 'Speed',
  diameterMm: 'Diameter',
  rollers: 'Rollers',
  rollerAngleDeg: 'Roller angle',
  columns: 'Columns',
  tiePoints: 'Tie points',
}

const UNITS: Record<string, string> = {
  watts: ' W',
  forwardVoltageV: ' V',
  maxCurrentMA: ' mA',
  volts: ' V',
  rangeCm: ' cm',
  frequencyKHz: ' kHz',
  accuracyC: ' °C',
  logicV: ' V',
  clockMHz: ' MHz',
  maxCurrentA: ' A',
  maxVolts: ' V',
  capacityMah: ' mAh',
  rpm: ' rpm',
  diameterMm: ' mm',
  rollerAngleDeg: '°',
}

function format(key: string, v: number | string): string {
  if (key === 'ohms') return Number(v) >= 1000 ? `${Number(v) / 1000} kΩ` : `${v} Ω`
  if (key === 'farads') {
    const f = Number(v)
    return f >= 1e-6 ? `${+(f * 1e6).toPrecision(3)} µF` : `${+(f * 1e9).toPrecision(3)} nF`
  }
  return `${v}${UNITS[key] ?? ''}`
}

export function SpecTable({ entry }: { entry: CatalogEntry }) {
  const rows = Object.entries(entry.specs).filter(([k]) => k !== 'color')
  const pinLabels = entry.pins.map((p) => p.label).filter(Boolean)
  return (
    <View>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={styles.key}>{LABELS[k] ?? k}</Text>
          <Text style={styles.val}>{format(k, v)}</Text>
        </View>
      ))}
      {pinLabels.length > 0 && (
        <View style={styles.row}>
          <Text style={styles.key}>Pins</Text>
          <Text style={[styles.val, styles.pins]}>{pinLabels.join(' · ')}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.cardBorder,
    gap: 12,
  },
  key: { color: C.dim, fontSize: 14 },
  val: { color: C.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  pins: { flex: 1, textAlign: 'right' },
})
