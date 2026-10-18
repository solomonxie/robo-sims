import { DEG } from '../common'
import { TOOTH_DEG } from '../kinematics/armbuild'
import { focalPx } from '../perception/projection'
import { medianMs } from '../../stopwatch'
import { PT_FRAMES, PT_RIG, ptAim, ptBallAt, ptBallPx, ptCoverage, ptInCamera, ptLoop, ptRange, ptRayToWall, ptShotPx, ptStats, ptTrackRun, ptView } from './camtracker'

describe('pan-tilt rig', () => {
  it('loop rate: the slower of grab and processing; processing grows with the pixel count', () => {
    expect(ptLoop('qqvga').fps).toBe(PT_FRAMES.qqvga.grabFps)
    expect(ptLoop('vga').procMs).toBeCloseTo(640 * 480 * PT_RIG.usPerPx / 1000, 6)
    expect(ptLoop('vga').fps).toBeCloseTo(1000 / ptLoop('vga').procMs, 6)
    expect(ptLoop('vga').latencyMs).toBeGreaterThan(ptLoop('qvga').latencyMs)
  })
  it('ball size is f·R/d and the range doubles with the frame width', () => {
    expect(ptBallPx('stock', 'qvga', 2)).toBeCloseTo((focalPx(66, 320) * PT_RIG.ballR) / 2, 6)
    const q = ptRange('stock', 'qqvga')
    expect(ptRange('stock', 'qvga') / q).toBeCloseTo(2, 0)
    expect(ptRange('wide', 'qqvga')).toBeLessThan(q)
    expect(ptView('stock', 'qqvga', q * 0.8).best).not.toBeNull()
    expect(ptView('stock', 'qqvga', q * 1.3).best).toBeNull()
  })
  it('a horn one tooth off shifts the pan range; coverage adds half the field of view each side', () => {
    const c = ptCoverage('stock', 'qvga', 1)
    expect(c.pan[0]).toBeCloseTo(-90 + TOOTH_DEG, 6)
    expect(c.see.left).toBeCloseTo(90 + TOOTH_DEG + 33, 6)
    expect(c.vfov).toBeCloseTo((2 * Math.atan(Math.tan(33 * DEG) * 0.75)) / DEG, 6)
  })
})

describe('colour tracking loop', () => {
  it('aiming at a wall point puts it on the optical axis', () => {
    const [p, t] = ptAim([0.3, -0.2])
    const [l, u, z] = ptInCamera([0.3, -0.2], p, t)
    expect(Math.abs(l) + Math.abs(u)).toBeLessThan(1e-9)
    expect(z).toBeCloseTo(Math.hypot(0.3, 0.2, 1), 9)
    const hit = ptRayToWall(p, t, 0.1, -0.05)!
    const back = ptInCamera(hit, p, t)
    expect(back[0] / back[2]).toBeCloseTo(0.1, 9)
    expect(back[1] / back[2]).toBeCloseTo(-0.05, 9)
    expect(ptRayToWall(p, t, 0, 0)![0]).toBeCloseTo(0.3, 9)
  })
  it('still ball: 1° servo steps hunt without a dead zone, stop with one', () => {
    expect(ptBallAt('hover', 2)).toEqual([0.18, 0.08])
    const hunt = ptStats(ptTrackRun({ frame: 'qqvga', kp: 6, deadDeg: 0, path: 'hover' }))
    const calm = ptStats(ptTrackRun({ frame: 'qqvga', kp: 6, deadDeg: 0.6, path: 'hover' }))
    expect(hunt.writesPerS).toBeGreaterThan(3)
    expect(calm.writesPerS).toBeLessThan(0.5)
    expect(calm.worst).toBeLessThan(1)
  })
  it('moving ball: more gain cuts the lag; VGA’s delay makes the same gain lose the ball', () => {
    const lo = ptStats(ptTrackRun({ frame: 'qvga', kp: 6, deadDeg: 0.5, path: 'circle' }))
    const hi = ptStats(ptTrackRun({ frame: 'qvga', kp: 12, deadDeg: 0.5, path: 'circle' }))
    expect(hi.rms).toBeLessThan(lo.rms * 0.7)
    expect(hi.lostS).toBe(0)
    const vga = ptStats(ptTrackRun({ frame: 'vga', kp: 12, deadDeg: 0.5, path: 'circle' }))
    expect(vga.lostS).toBeGreaterThan(1)
  })
  it('display mapping keeps the frame centre at the display centre and scales by zoom', () => {
    expect(ptShotPx(159.5, 119.5, 320, 64, 48, 2.5)).toEqual([31.5, 23.5])
    expect(ptShotPx(169.5, 119.5, 320, 64, 48, 2.5)[0] - 31.5).toBeCloseTo(5, 9)
  })
  it('a run is fast enough to recompute on a slider change', () => {
    expect(medianMs(() => ptTrackRun({ frame: 'qvga', kp: 8, deadDeg: 0.5, path: 'toss' }), 3)).toBeLessThan(1500)
  })
})
