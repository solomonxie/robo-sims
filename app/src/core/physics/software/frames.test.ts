import { LOOP, POST, compose2, invert2, loopLength, loopPose, odomPose, poseTf, tfChain } from './frames'
import { apply4 } from './urdf'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('2D transforms', () => {
  it('composes a translation then a turn', () => {
    const p = compose2({ x: 1, y: 2, th: Math.PI / 2 }, { x: 1, y: 0, th: 0 })
    close(p.x, 1)
    close(p.y, 3)
    close(p.th, Math.PI / 2)
  })

  it('inverts to identity', () => {
    const a = { x: 0.7, y: -1.2, th: 2.4 }
    const id = compose2(a, invert2(a))
    close(id.x, 0)
    close(id.y, 0)
    close(id.th, 0)
  })

  it('matches the 4×4 form', () => {
    const a = { x: 0.3, y: 0.5, th: 1 }
    const b = compose2(a, { x: 2, y: -1, th: 0 })
    const [x, y] = apply4(poseTf(a), [2, -1, 0])
    close(x, b.x)
    close(y, b.y)
  })
})

describe('loop drive', () => {
  it('starts at the start and closes the loop', () => {
    const p = loopPose(loopLength())
    close(p.x, LOOP.start.x)
    close(p.y, LOOP.start.y)
  })

  it('is continuous at the joins', () => {
    for (const s of [LOOP.straight, LOOP.straight + Math.PI * LOOP.r]) {
      const a = loopPose(s - 1e-7)
      const b = loopPose(s + 1e-7)
      close(a.x, b.x, 1e-5)
      close(a.y, b.y, 1e-5)
    }
  })

  it('is half way round after half a lap', () => {
    const p = loopPose(LOOP.straight + Math.PI * LOOP.r)
    close(p.y, 2 * LOOP.r)
    close(Math.abs(p.th), Math.PI)
  })
})

describe('odometry drift', () => {
  it('starts at zero and drifts with distance', () => {
    expect(odomPose(0)).toEqual({ x: 0, y: 0, th: 0 })
    const err = (s: number) => {
      const o = compose2(LOOP.start, odomPose(s))
      const t = loopPose(s)
      return Math.hypot(o.x - t.x, o.y - t.y)
    }
    expect(err(2)).toBeGreaterThan(0.02)
    expect(err(9)).toBeGreaterThan(err(2))
  })
})

describe('lidar point through the tree', () => {
  it('lands on the post with map correction', () => {
    const c = tfChain(7, true)
    expect(c.err).toBeLessThan(1e-9)
    close(Math.hypot(c.p[3][0] - POST.x, c.p[3][1] - POST.y), POST.r)
  })

  it('adds the lidar mount offset going to base_link', () => {
    const c = tfChain(3, true)
    close(c.p[1][2] - c.p[0][2], 0.07)
  })

  it('misses without correction once odometry drifts', () => {
    expect(tfChain(0, false).err).toBeLessThan(1e-9)
    expect(tfChain(12, false).err).toBeGreaterThan(0.3)
  })
})
