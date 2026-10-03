// Data-driven part list. `type` picks the 3D model builder; specs drive its look.
// Units for pins: hole pitches (2.54 mm) from the part's origin.

export type PartType =
  | 'breadboard'
  | 'resistor'
  | 'led'
  | 'ceramic-cap'
  | 'electrolytic-cap'
  | 'jumper'
  | 'battery-18650'
  | 'esp32'
  | 'l298n'
  | 'hc-sr04'
  | 'dht11'
  | 'tt-motor'
  | 'wheel'
  | 'mecanum-wheel'

export type Category = 'Boards' | 'Passives' | 'Sensors' | 'Controllers' | 'Power' | 'Motion' | 'Wiring'

export interface Pin {
  id: string
  label?: string
  x: number
  z: number
}

export interface CatalogEntry {
  name: string
  type: PartType
  title: string
  description: string
  category: Category
  pins: Pin[]
  specs: Record<string, number | string>
}

const twoLeads = (span: number, a = 'a', b = 'b'): Pin[] => [
  { id: a, x: -span / 2, z: 0 },
  { id: b, x: span / 2, z: 0 },
]

const headerRow = (labels: string[], z: number): Pin[] =>
  labels.map((label, i) => ({ id: label.toLowerCase(), label, x: i - (labels.length - 1) / 2, z }))

// DOIT ESP32 DevKit v1, 30-pin, antenna toward −x.
const ESP32_LEFT = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN']
const ESP32_RIGHT = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3']

export const CATALOG: CatalogEntry[] = [
  {
    name: 'breadboard-half',
    type: 'breadboard',
    title: 'Half breadboard',
    description: '400 tie points: 30 columns of 5-hole strips, two power rails per edge',
    category: 'Boards',
    pins: [],
    specs: { columns: 30, tiePoints: 400 },
  },
  {
    name: 'resistor-220',
    type: 'resistor',
    title: '220 Ω resistor',
    description: '¼ W carbon film, 5%. The usual LED current limiter at 3.3–5 V',
    category: 'Passives',
    pins: twoLeads(4),
    specs: { ohms: 220, watts: 0.25, tolerance: '±5%' },
  },
  {
    name: 'resistor-1k',
    type: 'resistor',
    title: '1 kΩ resistor',
    description: '¼ W carbon film, 5%',
    category: 'Passives',
    pins: twoLeads(4),
    specs: { ohms: 1000, watts: 0.25, tolerance: '±5%' },
  },
  {
    name: 'resistor-10k',
    type: 'resistor',
    title: '10 kΩ resistor',
    description: '¼ W carbon film, 5%. Pull-ups, dividers',
    category: 'Passives',
    pins: twoLeads(4),
    specs: { ohms: 10000, watts: 0.25, tolerance: '±5%' },
  },
  {
    name: 'led-red',
    type: 'led',
    title: 'Red LED',
    description: '5 mm. Long leg is the anode (+)',
    category: 'Passives',
    pins: twoLeads(1, 'anode', 'cathode'),
    specs: { color: '#ff2a1a', forwardVoltageV: 2.0, maxCurrentMA: 20 },
  },
  {
    name: 'led-green',
    type: 'led',
    title: 'Green LED',
    description: '5 mm. Long leg is the anode (+)',
    category: 'Passives',
    pins: twoLeads(1, 'anode', 'cathode'),
    specs: { color: '#2bff5a', forwardVoltageV: 2.2, maxCurrentMA: 20 },
  },
  {
    name: 'cap-100nf',
    type: 'ceramic-cap',
    title: '100 nF ceramic capacitor',
    description: 'Code "104". Decoupling next to a chip’s power pins',
    category: 'Passives',
    pins: twoLeads(2),
    specs: { farads: 1e-7, code: '104' },
  },
  {
    name: 'cap-100uf',
    type: 'electrolytic-cap',
    title: '100 µF electrolytic capacitor',
    description: '16 V. Polarized: the striped side is (−)',
    category: 'Passives',
    pins: twoLeads(1, 'pos', 'neg'),
    specs: { farads: 1e-4, volts: 16 },
  },
  {
    name: 'hc-sr04',
    type: 'hc-sr04',
    title: 'HC-SR04 ultrasonic sensor',
    description: '2–400 cm ranging by 40 kHz echo time. 5 V',
    category: 'Sensors',
    pins: headerRow(['VCC', 'Trig', 'Echo', 'GND'], 0),
    specs: { rangeCm: 400, volts: 5, frequencyKHz: 40 },
  },
  {
    name: 'dht11',
    type: 'dht11',
    title: 'DHT11 temperature + humidity',
    description: '0–50 °C ±2 °C, 20–90% RH, one-wire digital',
    category: 'Sensors',
    pins: headerRow(['VCC', 'DATA', 'NC', 'GND'], 0),
    specs: { volts: 3.3, accuracyC: 2 },
  },
  {
    name: 'esp32-devkit',
    type: 'esp32',
    title: 'ESP32 DevKit v1',
    description: 'Dual-core 240 MHz, Wi-Fi + Bluetooth, 30 pins, 3.3 V logic',
    category: 'Controllers',
    pins: [...headerRow(ESP32_LEFT, 5), ...headerRow(ESP32_RIGHT, -5)],
    specs: { logicV: 3.3, clockMHz: 240, gpio: 25 },
  },
  {
    name: 'l298n',
    type: 'l298n',
    title: 'L298N motor driver',
    description: 'Dual H-bridge, 2 A per channel, onboard 5 V regulator',
    category: 'Controllers',
    pins: headerRow(['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'], 6.8),
    specs: { maxCurrentA: 2, maxVolts: 35, logicV: 5 },
  },
  {
    name: 'battery-18650',
    type: 'battery-18650',
    title: '18650 Li-ion cell + holder',
    description: '3.7 V nominal, 4.2 V full, 2600 mAh',
    category: 'Power',
    pins: [],
    specs: { volts: 3.7, capacityMah: 2600 },
  },
  {
    name: 'tt-motor',
    type: 'tt-motor',
    title: 'TT gear motor',
    description: '3–6 V DC, 1:48 gearbox, double shaft',
    category: 'Motion',
    pins: [],
    specs: { volts: 6, ratio: '1:48', rpm: 200 },
  },
  {
    name: 'wheel-65',
    type: 'wheel',
    title: '65 mm wheel',
    description: 'Rubber tire for the TT motor’s D-shaft',
    category: 'Motion',
    pins: [],
    specs: { diameterMm: 65 },
  },
  {
    name: 'mecanum-60',
    type: 'mecanum-wheel',
    title: '60 mm mecanum wheel',
    description: '9 rollers at 45°: drive sideways by mixing wheel directions',
    category: 'Motion',
    pins: [],
    specs: { diameterMm: 60, rollers: 9, rollerAngleDeg: 45 },
  },
  {
    name: 'jumper-red',
    type: 'jumper',
    title: 'Jumper wire',
    description: 'Male-male Dupont, 0.1" pins',
    category: 'Wiring',
    pins: twoLeads(6, 'from', 'to'),
    specs: { color: '#d8282b' },
  },
]

export const CATEGORIES: Category[] = ['Boards', 'Passives', 'Sensors', 'Controllers', 'Power', 'Motion', 'Wiring']

export function entry(name: string): CatalogEntry {
  const found = CATALOG.find((e) => e.name === name)
  if (!found) throw new Error(`no catalog entry ${name}`)
  return found
}

export const num = (e: CatalogEntry, key: string): number => Number(e.specs[key])
export const str = (e: CatalogEntry, key: string): string => String(e.specs[key])
