import * as THREE from 'three/webgpu'
import { CATALOG } from '../core/catalog'
import { createBench } from '../scene/bench'
import { buildModel } from '.'

describe('buildModel', () => {
  it.each(CATALOG.map((e) => [e.name, e] as const))('%s builds finite, non-empty geometry', (_, e) => {
    const box = new THREE.Box3().setFromObject(buildModel(e))
    const size = box.getSize(new THREE.Vector3())
    expect(box.isEmpty()).toBe(false)
    for (const v of size.toArray()) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeLessThan(60)
    }
  })
})

describe('createBench', () => {
  it('lights the LED from the 18650 through 220 Ω', () => {
    const bench = createBench()
    expect(bench.reading().status).toBe('lit')
  })
  it('dims the LED with a bigger resistor', () => {
    const bench = createBench()
    const before = bench.reading().currentMA
    expect(bench.setResistor('resistor-10k').currentMA).toBeLessThan(before)
    expect(bench.parts.filter((p) => p.id === 'R1')).toHaveLength(1)
  })
})
