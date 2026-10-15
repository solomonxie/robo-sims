import { IDENTITY4, ROVER, ROVER_URDF, apply4, invert4, jointValue, linkFrames, mul4, parseUrdf, rotAxis4, tf3, urdfTree } from './urdf'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const closeP = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => close(v, b[i], eps))

describe('homogeneous transforms', () => {
  it('rotates then translates', () => {
    closeP(apply4(tf3([1, 2, 3], [0, 0, Math.PI / 2]), [1, 0, 0]), [1, 3, 3])
  })

  it('applies roll, then pitch, then yaw', () => {
    const m = tf3([0, 0, 0], [Math.PI / 2, 0, Math.PI / 2])
    closeP(apply4(m, [0, 1, 0]), [0, 0, 1])
    closeP(apply4(m, [1, 0, 0]), [0, 1, 0])
  })

  it('inverts a rigid transform', () => {
    const m = tf3([0.3, -1, 2], [0.4, -0.2, 1.1])
    closeP(mul4(m, invert4(m)), IDENTITY4)
  })

  it('rotates about an arbitrary axis', () => {
    closeP(apply4(rotAxis4([0, 0, 2], Math.PI / 2), [1, 0, 0]), [0, 1, 0])
    closeP(rotAxis4([1, 1, 0], Math.PI / 3), mul4(rotAxis4([1, 1, 0], Math.PI / 6), rotAxis4([1, 1, 0], Math.PI / 6)))
  })
})

describe('URDF', () => {
  it('reads links, geometry and joints with their lines', () => {
    expect(ROVER.name).toBe('rover')
    expect(ROVER.links.map((l) => l.name)).toEqual(['base_link', 'left_wheel', 'right_wheel', 'lidar_link', 'camera_link', 'arm_link'])
    const base = ROVER.links[0]
    expect(base.visual!.geom).toEqual({ kind: 'box', size: [0.3, 0.2, 0.06] })
    expect(base.collision!.geom).toEqual({ kind: 'box', size: [0.34, 0.24, 0.08] })
    expect(ROVER.links[1].visual!.geom).toEqual({ kind: 'cylinder', radius: 0.033, length: 0.026 })
    expect(ROVER.links[5].visual!.xyz).toEqual([0.07, 0, 0])
    const lines = ROVER_URDF.split('\n')
    expect(lines[base.line]).toContain('<link name="base_link">')
    expect(lines[base.end]).toContain('</link>')
    const arm = ROVER.joints.find((j) => j.name === 'arm_joint')!
    expect(arm).toMatchObject({ type: 'revolute', parent: 'base_link', child: 'arm_link', axis: [0, -1, 0], limit: [0, 1.2] })
    expect(lines[arm.end]).toContain('</joint>')
  })

  it('builds one tree rooted at base_link', () => {
    const t = urdfTree(ROVER)
    expect(t.root).toBe('base_link')
    expect(t.children.base_link).toHaveLength(5)
    expect(t.jointOf.left_wheel.type).toBe('continuous')
  })

  it('rejects a link with two parents and unknown links', () => {
    const two = parseUrdf(`<robot name="x"><link name="a"/><link name="b"/><link name="c"/>
      <joint name="j1" type="fixed"><parent link="a"/><child link="c"/></joint>
      <joint name="j2" type="fixed"><parent link="b"/><child link="c"/></joint></robot>`)
    expect(() => urdfTree(two)).toThrow('two parents')
    const bad = parseUrdf(`<robot name="x"><link name="a"/><joint name="j" type="fixed"><parent link="a"/><child link="z"/></joint></robot>`)
    expect(() => urdfTree(bad)).toThrow('unknown link')
    expect(() => parseUrdf('<robot name="x"><link name="a"></robot>')).toThrow()
  })

  it('places fixed links at their origin', () => {
    const f = linkFrames(ROVER)
    closeP(apply4(f.lidar_link, [0, 0, 0]), [0.05, 0, 0.07])
    closeP(apply4(f.left_wheel, [0, 0, 1]).map((v, i) => v - [0, 0.12, 0][i]), [0, 1, 0], 1e-5)
  })

  it('moves the arm about its axis and clamps it to the limit', () => {
    const arm = ROVER.joints.find((j) => j.name === 'arm_joint')!
    expect(jointValue(arm, 2)).toBe(1.2)
    expect(jointValue(arm, -1)).toBe(0)
    const tip = (q: number) => apply4(linkFrames(ROVER, { arm_joint: q }).arm_link, [0.14, 0, 0])
    closeP(tip(0), [0.04, 0, 0.045])
    closeP(tip(Math.PI / 2 + 5), tip(1.2))
    expect(tip(1)[2]).toBeGreaterThan(0.045 + 0.1)
  })

  it('spins a continuous wheel without limit', () => {
    const w = (q: number) => linkFrames(ROVER, { left_wheel_joint: q }).left_wheel
    closeP(w(2 * Math.PI), w(0))
    closeP(apply4(w(Math.PI / 2), [0.033, 0, 0]), [0, 0.12, -0.033], 1e-5)
  })
})
