import * as THREE from 'three/webgpu'
import { TASK_FIELD, FLOCK, FLOCK_RULES, FlockRules, SWARM, V2, XY, assignTotal, auctionAssign, costMatrix, driveToGoals, flockRun, greedyAssign, optimalAssign, taskLayout, tripCrossings } from '../../core/physics'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, DATA_COLOR, GREY, HEAT, HIGH_V, JOINT_COLORS, LABEL, POWER, RING, addLabel, countBars, diffBot, flatBox, floorMat, floorView, glowMat, liveLabel, memoBy, pointCloud, rayFan, ringMarks, rodPool, scope } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-0.6, 2.4, 0] as V3, radius: 60, polar: Math.PI / 2, azimuth: 0 }
const WF = { x: 10.4, y: 0.6, w: 10.5, h: 6.4 }
const TOP = 7.6
const K = 6.2
const cm = (m: number) => `${Math.round(m * 100)} cm`
const z3 = (p: { x: number; y: number } | XY, z = 0.02): V3 => (Array.isArray(p) ? [p[0], p[1], z] : [p.x, p.y, z])

/** Walled arena (centred on 0) on a tilted floor, with status lines above it. */
function arenaStage(scene: THREE.Scene, w: number, h: number) {
  const g = floorView(scene, [-7.7, 0.3, 0], K, -0.5)
  floorMat(g, [-w / 2 - 0.08, w / 2 + 0.08], [-h / 2 - 0.08, h / 2 + 0.08])
  const wall = new THREE.MeshStandardMaterial({ color: '#59606c', roughness: 0.7 })
  for (const s of [1, -1]) {
    flatBox(g, [w + 0.06, 0.03, 0.06], wall, [0, s * (h / 2 + 0.015), 0.03])
    flatBox(g, [0.03, h + 0.06, 0.06], wall, [s * (w / 2 + 0.015), 0, 0.03])
  }
  const status = liveLabel(scene, [-18.6, TOP + 1.2, 0.3], { size: 0.44, align: 'left' })
  const sub = liveLabel(scene, [-18.6, TOP + 0.4, 0.3], { size: 0.3, color: GREY, align: 'left' })
  return { g, status, sub }
}

/** Looping timer that restarts when the key changes. */
function loopTimer(total: number) {
  const st = { key: '', t: 0 }
  return (dt: number, key: string, len = total) => {
    if (key !== st.key) [st.key, st.t] = [key, 0]
    st.t += dt
    if (st.t > len) st.t = 0
    return st.t
  }
}

// --- Flocking: Reynolds boids on twelve diff-drive robots that only know what reached them over the radio. ---

const SHOW = 2
const TRAIL = 14
const TRAIL_EVERY = 5
const flParams = (p: Params) => ({ range: n(p, 'range'), loss: n(p, 'loss') / 100, rules: pick(FLOCK_RULES, p.rules, 'all') as FlockRules })
type FlQ = ReturnType<typeof flParams>
const flKey = (q: FlQ) => `${q.range}|${q.loss}|${q.rules}`
const flRun = memoBy(flKey, (q: FlQ) => {
  const run = flockRun(q)
  const tail = run.slice(Math.floor(run.length * 0.75))
  return {
    run,
    order: tail.reduce((s, f) => s + f.order, 0) / tail.length,
    hears: run.reduce((s, f) => s + f.links.length / FLOCK.n, 0) / run.length,
  }
})
const orderTone = (v: number) => (v > 0.8 ? 'ok' : v > 0.5 ? 'warn' : 'bad')

export const swarmMultiRobotFlocking: Lesson = {
  id: 'swarm-multi-robot-flocking',
  title: 'Flocking',
  tagline: 'Three local rules, no leader: steer away from close neighbours, match their heading, drift toward their centre, and twelve robots move as one flock',
  formula: 'u = v + w_s Σ (p − pⱼ)/dⱼ² (dⱼ < 35 cm) + w_a (mean vⱼ − v) + w_c (mean pⱼ − p) + wall · steer toward u, speed |u| (5…25 cm/s)',
  legend: [
    { color: RING, label: 'Robot 1: its radio range, and the robots it hears', shape: 'dot' },
    { color: HIGH_V, label: 'Separation push; 35 cm separation ring', shape: 'arrow-right' },
    { color: DATA_COLOR, label: 'Alignment push', shape: 'arrow-right' },
    { color: POWER, label: 'Cohesion push', shape: 'arrow-right' },
    { color: B_FIELD, label: 'Packets that got through this step', shape: 'dot' },
  ],
  points: [
    'Craig Reynolds (1987) showed that a flock needs no leader and no plan. Each member looks only at its neighbours and adds three pushes to its velocity: separation (away from anyone too close, harder the closer they are), alignment (toward their average velocity) and cohesion (toward their average position). Real swarms of small robots work the same way; the robot turns toward the summed velocity u and drives at its length, through the diff-drive inverse from Mobility.',
    'Robots cannot see each other here: every 50 ms each one broadcasts its position and velocity, and neighbours inside the radio range hear it, like ESP-NOW broadcasts (Microcontrollers → ESP-NOW). A packet can be lost; a robot then steers on the last copy it heard, up to 0.5 s old. Blue lines are the packets that got through this step.',
    'Switch rules off to see what each one does. No separation: they pile into a clump and bump. No alignment: they gather but mill about with no common heading (polarisation, the length of the mean heading, stays low). No cohesion: they line up but drift apart into separate groups. A short range makes small groups that never meet.',
    'Raise the packet loss: separation now acts on stale positions, so robots bump, and alignment averages old headings. The flock frays long before the radio is fully dead. Walls push the flock back; dodging obstacles is the job of Obstacle avoidance, which a real swarm robot runs underneath these rules.',
  ],
  controls: [
    { kind: 'choice', key: 'rules', options: opts(FLOCK_RULES), initial: 'all' },
    { kind: 'slider', key: 'range', label: 'Radio range', min: 0.3, max: 1.6, step: 0.1, initial: 0.9, format: (v: number) => cm(v) },
    { kind: 'slider', key: 'loss', label: 'Packet loss', min: 0, max: 90, step: 5, initial: 0, format: (v: number) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = arenaStage(scene, FLOCK.w, FLOCK.h)
    const bots = Array.from({ length: FLOCK.n }, () => diffBot(s.g))
    const heads = rodPool(s.g, FLOCK.n + 3, { heads: true })
    const rings = ringMarks(s.g, 3, 0.04)
    const allLinks = rayFan(s.g, 80, glowMat(B_FIELD, 0.7), 0.006)
    const myLinks = rayFan(s.g, 12, glowMat(RING, 1), 0.01)
    const trail = pointCloud(s.g, FLOCK.n * TRAIL, 0.012)
    const plot = scope(scene, WF.w, WF.h, { divs: [8, 4], zeroAt: 0 })
    plot.group.position.set(WF.x, WF.y, 0)
    const orderTr = plot.trace(POWER, { samples: 240, radius: 0.08 })
    const gapTr = plot.trace(HEAT, { samples: 240, radius: 0.06 })
    addLabel(scene, 'polarisation (0…1) · closest pair (0…60 cm)', [WF.x - WF.w / 2, WF.y + WF.h / 2 + 1.7, 0.3], LABEL, 0.34, 'left')
    addLabel(scene, `dashed line: bump (closer than ${cm(2 * SWARM.body)})`, [WF.x - WF.w / 2, WF.y + WF.h / 2 + 0.9, 0.3], GREY, 0.28, 'left')
    addLabel(scene, '0 s', [WF.x - WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], GREY, 0.28, 'left')
    addLabel(scene, `${FLOCK.seconds} s`, [WF.x + WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], GREY, 0.28, 'right')
    plot.level(HEAT).set(-WF.h / 2 + (2 * SWARM.body / 0.6) * WF.h)
    const lines = [0, 1, 2].map((i) => liveLabel(scene, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 2.0 - i * 0.8, 0.3], { size: 0.32, align: 'left' }))
    const timer = loopTimer(FLOCK.seconds / SHOW + 2)
    const st = { key: '', k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = flParams(p)
        const key = flKey(q)
        const R = flRun(q)
        const k = Math.min(R.run.length - 1, Math.round((timer(dt, key) * SHOW) / FLOCK.dt))
        if (k === st.k && key === st.key) return
        Object.assign(st, { key, k })
        const f = R.run[k]
        f.poses.forEach((pose, i) => {
          bots[i].set(pose, f.wheels[i][0], f.wheels[i][1])
          const a = z3(pose, 0.1)
          heads.set(i, a, [a[0] + 0.16 * Math.cos(pose.th), a[1] + 0.16 * Math.sin(pose.th), 0.1], 0.008, i === 0 ? RING : LABEL)
        })
        const me = f.poses[0]
        const push = f.push
        const arrows: [V2, string][] = [[push.sep, HIGH_V], [push.ali, DATA_COLOR], [push.coh, POWER]]
        arrows.forEach(([v, c], j) => {
          const k1 = Math.min(1.5, 0.45 / Math.max(1e-6, Math.hypot(v[0], v[1])))
          heads.set(FLOCK.n + j, z3(me, 0.14), [me.x + k1 * v[0], me.y + k1 * v[1], 0.14], 0.01, c)
        })
        heads.commit()
        rings.set(0, z3(me, 0.006), q.range, RING)
        rings.set(1, z3(me, 0.007), FLOCK.sepR, HIGH_V)
        rings.set(2, z3(me, 0.008), 0.13, RING)
        rings.commit()
        const segs: [V3, V3][] = []
        for (let j = 0; j < f.links.length; j += 2) segs.push([z3(f.poses[f.links[j]], 0.09), z3(f.poses[f.links[j + 1]], 0.09)])
        allLinks(segs)
        myLinks(f.mates0.map((j) => [z3(me, 0.1), z3(f.poses[j], 0.1)] as [V3, V3]))
        let dots = 0
        for (let m = 1; m <= TRAIL; m++) {
          const back = k - m * TRAIL_EVERY
          if (back < 0) break
          R.run[back].poses.forEach((pose, i) => trail.set(dots++, z3(pose, 0.005), i === 0 ? RING : GREY, 1 - m / (TRAIL + 4)))
        }
        trail.show(dots)
        const us: number[] = []
        const ys: number[] = []
        const gs: number[] = []
        for (let i = 0; i <= k; i += 4) {
          us.push(i / (R.run.length - 1))
          ys.push(-WF.h / 2 + R.run[i].order * WF.h)
          gs.push(-WF.h / 2 + (Math.min(0.6, R.run[i].minGap) / 0.6) * WF.h)
        }
        orderTr.points(us, ys)
        gapTr.points(us, gs)
        lines[0].set(`polarisation ${f.order.toFixed(2)} · ${f.groups} group${f.groups > 1 ? 's' : ''} in radio reach`, f.order > 0.8 ? POWER : f.order > 0.5 ? RING : HIGH_V)
        lines[1].set(`closest pair ${cm(f.minGap)} · ${f.bumps} bump${f.bumps === 1 ? '' : 's'} so far`, f.minGap < 2 * SWARM.body ? HIGH_V : HEAT)
        lines[2].set(`robot 1 hears ${f.mates0.length} of ${FLOCK.n - 1}${f.mates0.length ? '' : ': drives straight on'}`, f.mates0.length ? RING : GREY)
        s.status.set(`Boids · ${FLOCK_RULES[q.rules].toLowerCase()} · t ${f.t.toFixed(1)} s`, LABEL)
        s.sub.set(`${FLOCK.n} TT robots in ${FLOCK.w} × ${FLOCK.h} m · radio ${cm(q.range)}, ${Math.round(q.loss * 100)} % lost · ×${SHOW} speed`)
      },
      readouts: (p) => {
        const R = flRun(flParams(p))
        const end = R.run[R.run.length - 1]
        return [
          { label: 'Polarisation (last 10 s)', value: R.order.toFixed(2), tone: orderTone(R.order) },
          { label: `Bumps in ${FLOCK.seconds} s`, value: `${end.bumps}`, tone: end.bumps < 6 ? 'ok' : end.bumps < 20 ? 'warn' : 'bad' },
          { label: 'Groups at the end', value: `${end.groups}`, tone: end.groups === 1 ? 'ok' : 'warn' },
          { label: 'Packets heard per robot', value: `${R.hears.toFixed(1)} / step` },
        ]
      },
    }
  },
}

// --- Task allocation: one task per robot; greedy nearest-pair vs a distributed auction, against the brute-force best. ---

const METHODS = { greedy: 'Greedy: cheapest pair first', auction: 'Auction: robots bid' }
const SHORT = { greedy: 'Greedy', auction: 'Auction' }
type Method = keyof typeof METHODS
const STEP_MAX = 0.7
const BID_SHOW = 7
const taParams = (p: Params) => ({ method: pick(METHODS, p.method, 'auction') as Method, n: n(p, 'n'), seed: n(p, 'seed'), eps: n(p, 'eps') })
type TaQ = ReturnType<typeof taParams>
const taKey = (q: TaQ) => `${q.method}|${q.n}|${q.seed}|${q.eps}`
const taRun = memoBy(taKey, (q: TaQ) => {
  const L = taskLayout(q.n, q.seed)
  const C = costMatrix(L.robots, L.tasks)
  const greedy = greedyAssign(C)
  const auction = auctionAssign(C, q.eps)
  const best = optimalAssign(C)
  const steps =
    q.method === 'greedy'
      ? greedy.picks.map((_, k) => ({ bids: [{ robot: greedy.picks[k][0], task: greedy.picks[k][1] }], owner: L.tasks.map((_t, j) => greedy.picks.slice(0, k + 1).find((pk) => pk[1] === j)?.[0] ?? -1), prices: null as number[] | null }))
      : auction.rounds.map((r) => ({ bids: r.bids, owner: r.owner, prices: r.prices as number[] | null }))
  const assign = q.method === 'greedy' ? greedy.assign : auction.assign
  const drive = driveToGoals(L.robots, assign.map((j) => L.tasks[j]))
  const step = Math.min(STEP_MAX, BID_SHOW / steps.length)
  const trips = assign.map((j, i) => C[i][j])
  return {
    ...L,
    steps,
    step,
    assign,
    drive,
    trips,
    total: assignTotal(C, assign),
    totals: [assignTotal(C, greedy.assign), assignTotal(C, auction.assign), best.total],
    best: best.total,
    crossings: tripCrossings(L.robots, L.tasks, assign),
    bids: q.method === 'greedy' ? q.n * q.n : auction.bids,
    bidT: step * (steps.length + 1),
    driveT: drive.length * TASK_FIELD.dt,
  }
})
const colorOf = (i: number) => (i < 0 ? GREY : [...JOINT_COLORS, B_FIELD, '#ffffff'][i % 8])

export const swarmMultiRobotTaskAllocation: Lesson = {
  id: 'swarm-multi-robot-task-allocation',
  title: 'Task allocation',
  tagline: 'Who goes where? Greedy takes the closest pair first and can leave someone a long trip; an auction lets the robots bid it out over the radio',
  formula: (p) =>
    taParams(p).method === 'greedy'
      ? 'repeat: take the cheapest (robot, task) pair still free · cost = straight-line distance'
      : 'unassigned robot i: best task j* = argmin (cᵢⱼ + pⱼ) · bid p_j* += (2nd best − best) + ε · highest bid wins · total ≤ optimum + n·ε',
  legend: [
    { color: JOINT_COLORS[0], label: 'Robot colours: bids (arrows) and won tasks (lines)', shape: 'dot' },
    { color: GREY, label: 'Task not yet won; price above it (auction)', shape: 'dot' },
    { color: HIGH_V, label: 'Trips that cross', shape: 'dot' },
  ],
  points: [
    'A fleet gets n jobs (pick up a box, check a shelf) and must split them, one each. The cost here is the straight-line trip. Trying every split finds the best total, but there are n! of them: 40 320 for 8 robots, 3.6 million for 10. Real fleets need something cheaper.',
    'Greedy: take the cheapest (robot, task) pair of all, then the cheapest of what is left, and so on. Fast and often close, but the robots that pick first can take a task someone else needed more, leaving a long trip at the end and crossing paths. It also needs every cost in one place, a central planner.',
    'Auction (Bertsekas, 1979): each task has a price, starting at 0. Every robot without a task picks the one with the lowest cost + price and bids: it raises that price by how much better it is than its second choice, plus a small step ε. The highest bid wins; an outbid robot bids again next round. Only bids and prices go over the radio (one broadcast per round, see Microcontrollers → ESP-NOW), and the result is within n·ε of the best.',
    'ε trades speed for quality: a big step settles in a few rounds but can stop at a worse split; a small one fights longer and lands on the best total. In the best split no two trips cross (swap two crossing trips and both get shorter), so crossings are a quick sign of waste. Once a robot drives, it still needs Obstacle avoidance and the Flocking separation rule to pass the others.',
  ],
  controls: [
    { kind: 'choice', key: 'method', options: opts(METHODS), initial: 'auction' },
    { kind: 'slider', key: 'n', label: 'Robots and tasks', min: 3, max: 8, step: 1, initial: 6, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'seed', label: 'Layout', min: 1, max: 12, step: 1, initial: 5, format: (v: number) => `#${v}` },
    { kind: 'slider', key: 'eps', label: 'Bid step ε (auction)', min: 0.01, max: 0.5, step: 0.01, initial: 0.05, format: (v: number) => cm(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = arenaStage(scene, TASK_FIELD.w, TASK_FIELD.h)
    const bots = Array.from({ length: 8 }, () => diffBot(s.g))
    const tags = ringMarks(s.g, 16, 0.3)
    const bidArrows = rodPool(s.g, 8, { heads: true })
    const wonLines = rodPool(s.g, 8)
    const marks = pointCloud(s.g, 40, 0.035)
    const trail = pointCloud(s.g, 8 * 60, 0.01)
    const prices = Array.from({ length: 8 }, () => liveLabel(s.g, [0, 0, 0.02], { size: 0.075 }))
    const bars = countBars(scene, [WF.x - WF.w / 2 + 3.2, WF.y + WF.h / 2 - 0.6, 0], ['Greedy', 'Auction', 'Best (all n!)'], WF.w - 5.2, { row: 0.95, size: 0.32 })
    addLabel(scene, 'total distance, same layout', [WF.x - WF.w / 2, WF.y + WF.h / 2 + 1.0, 0.3], LABEL, 0.34, 'left')
    const lines = [0, 1, 2, 3].map((i) => liveLabel(scene, [WF.x - WF.w / 2, WF.y - 0.6 - i * 0.8, 0.3], { size: 0.32, align: 'left' }))
    const timer = loopTimer(1)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = taParams(p)
        const R = taRun(q)
        const t = timer(dt, taKey(q), R.bidT + R.driveT + 2.5)
        const k = Math.min(R.steps.length - 1, Math.floor(t / R.step))
        const bidding = t < R.bidT
        const di = Math.min(R.drive.length - 1, Math.max(0, Math.round((t - R.bidT) / TASK_FIELD.dt)))
        const d = R.drive[di]
        const owner = bidding ? R.steps[k].owner : R.tasks.map((_, j) => R.assign.indexOf(j))
        bots.forEach((b, i) => {
          b.group.visible = i < q.n
          if (i < q.n) b.set(d.poses[i], d.wheels[i][0], d.wheels[i][1])
        })
        R.robots.forEach((r, i) => tags.set(i, z3(d.poses[i], 0.004), 0.12, colorOf(i)))
        R.tasks.forEach((tk, j) => {
          tags.set(8 + j, z3(tk, 0.004), 0.07, colorOf(owner[j]))
          marks.set(j, z3(tk, 0.035), colorOf(owner[j]))
          const pr = R.steps[k].prices
          prices[j].group.position.set(tk[0], tk[1] + 0.12, 0.02)
          prices[j].set(bidding && pr ? `${Math.round(pr[j] * 100)}` : `${j + 1}`, colorOf(owner[j]))
        })
        tags.hideFrom(8 + q.n)
        for (let i = q.n; i < 8; i++) tags.set(i, [0, 0, -1], 0, GREY)
        tags.commit()
        prices.forEach((l, j) => (l.group.visible = j < q.n))
        R.crossings.forEach((c, i) => marks.set(q.n + i, z3(c, 0.03), HIGH_V, 0.8))
        marks.show(q.n + (bidding ? 0 : R.crossings.length))
        const bids = bidding ? R.steps[k].bids : []
        bids.forEach((b, i) => {
          const [a, e] = [z3(R.robots[b.robot], 0.06), z3(R.tasks[b.task], 0.06)]
          bidArrows.set(i, a, [a[0] + 0.85 * (e[0] - a[0]), a[1] + 0.85 * (e[1] - a[1]), 0.06], 0.011, colorOf(b.robot))
        })
        bidArrows.hideFrom(bids.length)
        bidArrows.commit()
        owner.forEach((i, j) => (i >= 0 ? wonLines.set(j, z3(R.robots[i], 0.02), z3(R.tasks[j], 0.02), bidding ? 0.006 : 0.005, colorOf(i)) : wonLines.set(j, [0, 0, 0], [0, 0, 0], 0, GREY)))
        wonLines.hideFrom(q.n)
        wonLines.commit()
        let dots = 0
        if (!bidding)
          for (let m = 0; m < di; m += 4) R.drive[m].poses.forEach((pose, i) => trail.set(dots++, z3(pose, 0.004), colorOf(i), 0.8))
        trail.show(Math.min(dots, 8 * 60))
        bars.set(R.totals, R.totals.map((v) => `${v.toFixed(2)} m`), [q.method === 'greedy' ? RING : GREY, q.method === 'auction' ? RING : GREY, POWER])
        const gap = (R.total / R.best - 1) * 100
        lines[0].set(`${SHORT[q.method]}: ${R.total.toFixed(2)} m, ${gap < 0.05 ? 'the best split' : `+${gap.toFixed(1)} % over the best`}`, gap < 0.05 ? POWER : gap < 5 ? RING : HIGH_V)
        lines[1].set(q.method === 'greedy' ? `central: ${q.n * q.n} costs in one place, ${q.n} picks` : `${R.steps.length} rounds, ${R.bids} bids broadcast`, GREY)
        lines[2].set(`longest trip ${cm(Math.max(...R.trips))} · ${R.crossings.length} crossing${R.crossings.length === 1 ? '' : 's'}`, R.crossings.length ? HIGH_V : GREY)
        lines[3].set(bidding ? (q.method === 'greedy' ? `pick ${k + 1} of ${R.steps.length}` : `round ${k + 1} of ${R.steps.length}: ${bids.length} bid${bids.length === 1 ? '' : 's'}`) : `driving · ${Math.min(t - R.bidT, R.driveT).toFixed(1)} of ${R.driveT.toFixed(1)} s`, LABEL)
        s.status.set(`Task allocation · ${q.n} robots, ${q.n} tasks · layout #${q.seed}`, LABEL)
        s.sub.set(bidding ? 'bidding (slowed down); numbers over tasks: price in cm' : `each robot drives to its task at ${cm(TASK_FIELD.v)}/s, real time`)
      },
      readouts: (p) => {
        const q = taParams(p)
        const R = taRun(q)
        const gap = (R.total / R.best - 1) * 100
        return [
          { label: 'Total distance', value: `${R.total.toFixed(2)} m (best ${R.best.toFixed(2)})`, tone: gap < 0.05 ? 'ok' : gap < 5 ? 'warn' : 'bad' },
          { label: 'Longest trip', value: cm(Math.max(...R.trips)) },
          { label: q.method === 'greedy' ? 'Picks' : 'Rounds · bids', value: q.method === 'greedy' ? `${q.n}` : `${R.steps.length} · ${R.bids}` },
          { label: 'Crossing trips', value: `${R.crossings.length}`, tone: R.crossings.length ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
