import * as THREE from 'three/webgpu'
import { CatalogEntry, num, str } from '../core/catalog'
import { buildBreadboard } from './breadboard'
import { buildDht11, buildEsp32, buildHcSr04, buildL298n } from './modules'
import { buildMecanum, buildTtMotor, buildWheel } from './motion'
import { buildCeramicCap, buildElectrolyticCap, buildLed, buildResistor } from './passives'
import { buildBattery18650 } from './power'
import { buildJumper } from './wire'

export function buildModel(e: CatalogEntry): THREE.Group {
  const g = build(e)
  g.name = e.name
  return g
}

function build(e: CatalogEntry): THREE.Group {
  switch (e.type) {
    case 'breadboard':
      return buildBreadboard()
    case 'resistor':
      return buildResistor(num(e, 'ohms'))
    case 'led':
      return buildLed(str(e, 'color'))
    case 'ceramic-cap':
      return buildCeramicCap()
    case 'electrolytic-cap':
      return buildElectrolyticCap()
    case 'jumper':
      return buildJumper({ x: -3, z: 0 }, { x: 3, z: 0 }, str(e, 'color'))
    case 'battery-18650':
      return buildBattery18650()
    case 'esp32':
      return buildEsp32()
    case 'l298n':
      return buildL298n()
    case 'hc-sr04':
      return buildHcSr04()
    case 'dht11':
      return buildDht11()
    case 'tt-motor':
      return buildTtMotor()
    case 'wheel':
      return buildWheel()
    case 'mecanum-wheel':
      return buildMecanum()
  }
}
