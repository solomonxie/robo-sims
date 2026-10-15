import {
  MOTOR_WORK,
  QUEUE_LEN,
  blockedOn,
  blockedTicks,
  collides,
  cpuShare,
  drops,
  intactShare,
  jobs,
  latencies,
  longestReady,
  mutexScene,
  peakFill,
  priorityScene,
  queueFillMs,
  queueScene,
  responses,
  serialText,
  simulate,
  taskIndex,
  waits,
} from './rtos'

describe('rtos scheduler', () => {
  it('lets a higher priority preempt at the next tick', () => {
    const r = simulate(priorityScene('preempt', false))
    const motor = taskIndex(r, 'motor')
    const tele = taskIndex(r, 'telemetry')
    expect(r.cores[1].slice(0, 6)).toEqual([tele, tele, motor, motor, motor, tele])
    expect(responses(r, motor).every((x) => x === MOTOR_WORK)).toBe(true)
    expect(jobs(r, motor)[0]).toEqual({ wake: 2, end: 5 })
    expect(r.state[3][tele]).toBe('ready')
  })

  it('time-slices equal priorities, stretching the motor job', () => {
    const r = simulate(priorityScene('equal', false))
    const motor = taskIndex(r, 'motor')
    expect(Math.max(...responses(r, motor))).toBeGreaterThan(MOTOR_WORK)
    expect(r.cores[1].slice(2, 6)).toEqual([0, 1, 0, 1])
  })

  it('starves lower tasks when a high one never blocks, unless they live on the other core', () => {
    const r = simulate(priorityScene('starve', false))
    const tele = taskIndex(r, 'telemetry')
    expect(longestReady(r, tele)).toBe(r.state.length - 2)
    expect(r.cores[1].slice(2).includes(-1)).toBe(false)
    const s = simulate(priorityScene('starve', true))
    expect(cpuShare(s, tele)).toBeGreaterThan(0.6)
    expect(longestReady(s, tele)).toBe(0)
  })

  it('idles a core when nothing is ready', () => {
    const r = simulate(priorityScene('preempt', true))
    expect(r.cores[1][0]).toBe(-1)
    expect(r.cores[0][0]).toBe(taskIndex(r, 'telemetry'))
  })
})

describe('rtos queues', () => {
  it('keeps a fast consumer blocked on an empty queue', () => {
    const r = simulate(queueScene('task', 5, 2))
    const ctl = taskIndex(r, 'control')
    expect(peakFill(r, 'readings')).toBe(0)
    expect(Math.max(...latencies(r, 'readings'))).toBe(0)
    expect(blockedTicks(r, ctl)).toBeGreaterThan(30)
  })

  it('fills when the consumer is slower: an ISR drops, a task blocks', () => {
    const isr = simulate(queueScene('isr', 2, 5))
    expect(peakFill(isr, 'readings')).toBe(QUEUE_LEN)
    expect(drops(isr, 'readings')).toBeGreaterThan(5)
    const task = simulate(queueScene('task', 2, 5))
    const sensor = taskIndex(task, 'sensor')
    expect(drops(task, 'readings')).toBe(0)
    expect(Math.max(...waits(task, sensor, 'readings'))).toBeGreaterThan(1)
    expect(Math.max(...latencies(task, 'readings'))).toBeGreaterThanOrEqual(QUEUE_LEN * 4)
  })

  it('says what a task waits on and when the queue fills', () => {
    const r = simulate(queueScene('task', 2, 5))
    const sensor = taskIndex(r, 'sensor')
    const t = r.state.findIndex((_, k) => blockedOn(r, sensor, k) === 'readings')
    expect(t).toBeGreaterThan(0)
    expect(r.queues.readings[t].length).toBe(QUEUE_LEN)
    expect(blockedOn(r, taskIndex(r, 'control'), 0)).toBe('readings')
    const idle = simulate(queueScene('task', 5, 2))
    expect(idle.state[2][sensor]).toBe('blocked')
    expect(blockedOn(idle, sensor, 2)).toBe('')
    expect(queueFillMs(4, 2, 5)).toBeCloseTo(13.33, 2)
    expect(queueFillMs(4, 5, 2)).toBe(Infinity)
  })

  it('delivers items in FIFO order', () => {
    const r = simulate(queueScene('isr', 3, 4))
    const ids = r.events.filter((e) => e.kind === 'recv').map((e) => e.item!)
    expect([...ids].sort((a, b) => a - b)).toEqual(ids)
  })
})

describe('rtos mutexes', () => {
  it('garbles shared Serial without a lock and keeps lines whole with one', () => {
    const raw = simulate(mutexScene('serial', 'none'))
    expect(collides(raw, 'serial')).toBe(true)
    expect(serialText(raw)).toContain('ax=L=')
    const locked = simulate(mutexScene('serial', 'mutex'))
    expect(collides(locked, 'serial')).toBe(false)
    expect(intactShare(serialText(raw), ['ax=0.12 ay=0.98', 'L=180 R=176'])).toBeLessThan(0.5)
    expect(intactShare(serialText(locked), ['ax=0.12 ay=0.98', 'L=180 R=176'])).toBe(1)
    for (const line of serialText(locked).split('\n').filter(Boolean)) expect(['ax=0.12 ay=0.98', 'L=180 R=176']).toContain(line)
  })

  it('corrupts an I²C transaction when unguarded', () => {
    expect(collides(simulate(mutexScene('i2c', 'none')), 'i2c')).toBe(true)
    expect(collides(simulate(mutexScene('i2c', 'semaphore')), 'i2c')).toBe(false)
  })

  it('shows priority inversion with a semaphore and fixes it with inheritance', () => {
    const sem = simulate(mutexScene('i2c', 'semaphore'))
    const mux = simulate(mutexScene('i2c', 'mutex'))
    const imu = taskIndex(sem, 'imu')
    const logger = taskIndex(sem, 'logger')
    expect(waits(sem, imu, 'i2c')).toEqual([18])
    expect(waits(mux, imu, 'i2c')).toEqual([4])
    expect(Math.max(...sem.prio.map((p) => p[logger]))).toBe(1)
    expect(mux.prio[3][logger]).toBe(5)
    expect(mux.prio[10][logger]).toBe(1)
  })
})
