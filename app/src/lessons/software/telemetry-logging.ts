import * as THREE from 'three/webgpu'
import {
  KP,
  LogFormat,
  LogRow,
  REPLAY,
  TELE,
  TeleFrame,
  aliasFrequency,
  faultRun,
  findSlip,
  findStall,
  fsSize,
  logAt,
  logBytesPerS,
  oscillation,
  replayAt,
  speedRun,
  streamHz,
  streamLoad,
  streamRun,
  txQueued,
  walledRoom,
} from '../../core/physics'
import { bytesText, hertz } from '../../core/units'
import { V3, add, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  cursorBar,
  floorView,
  glowMat,
  lidarRobot,
  liveLabel,
  memoBy,
  meterBar,
  packetPool,
  pointCloud,
  robotCar,
  roomModel,
  scope,
  simClock,
  topicPipe,
} from '../fx'
import { Lesson, Stage, opts, pick } from '../types'

// --- Plotting live data: a 200 Hz speed loop streamed over a 57.6 kbaud radio into a PlotJuggler-style plot. ---

const CTRL = { tuned: 'Tuned Kp 1', hot: 'Kp 5 (bug)' }
const RATE = { r10: '10 Hz (÷20)', r50: '50 Hz (÷4)', r200: '200 Hz (all)' }
const EVERY: Record<keyof typeof RATE, number> = { r10: 20, r50: 4, r200: 1 }
const AXIS = { stamp: 'x = header stamp', arrive: 'x = arrival time' }
const WINDOW = 2
const SPEED = { lo: -0.2, hi: 1 }
const HD_MAX = 180
const BATT = { lo: 7, hi: 8.2 }
const runMemo = memoBy((c: string) => c, (c) => speedRun(KP[c as keyof typeof KP]))
const streamMemo = memoBy((q: readonly [string, number]) => q.join(), ([c, every]) => streamRun(runMemo(c), every))
const plotParams = (p: Record<string, number | string>) => [pick(CTRL, p.ctrl, 'hot'), EVERY[pick(RATE, p.rate, 'r50')], pick(AXIS, p.axis, 'stamp')] as const
const linkText = (every: number) => `${bytesText(streamHz(every) * TELE.sampleBytes)}/s of ${bytesText(TELE.linkBps)}/s`

export const plottingLiveData: Lesson = {
  id: 'telemetry-logging-plotting-live-data',
  title: 'Plotting live data',
  tagline: 'Watch the signals while the robot runs',
  formula: (p) => {
    const [c, every] = plotParams(p)
    const o = oscillation(runMemo(c), 2, 3)
    const fs = streamHz(every)
    return `${hertz(fs)} × ${TELE.sampleBytes} B = ${linkText(every)} (${Math.round(streamLoad(every) * 100)} %)${o.pp > 0.05 ? ` · wobble ${hertz(o.hz)} plots as ${hertz(Math.abs(aliasFrequency(o.hz, fs)))}` : ''}`
  },
  legend: [
    { color: LABEL, label: 'Speed setpoint', shape: 'dot' },
    { color: HEAT, label: 'Measured speed', shape: 'dot' },
    { color: B_FIELD, label: 'Heading', shape: 'dot' },
    { color: POWER, label: 'Battery', shape: 'dot' },
    { color: HIGH_V, label: 'Resent frame (arrives late)', shape: 'dot' },
  ],
  points: [
    'The robot runs its speed loop at 200 Hz and streams four signals (setpoint, measured speed, heading, battery) to a laptop, where a tool like PlotJuggler or Foxglove draws them as scrolling lines. Each sample is a 12 B header, an 8 B timestamp and four 4 B floats: 36 B.',
    `Bandwidth sets the rate. A 57.6 kbaud telemetry radio moves ${bytesText(TELE.linkBps)}/s; every sample at 200 Hz needs ${linkText(1).split(' of')[0]}. The TX queue fills, the plot falls behind, and once ${TELE.queue} samples wait, new ones are dropped. Over Wi-Fi the budget is far bigger (Wi-Fi & Bluetooth → HTTP and WebSocket), but the same sum applies.`,
    'Decimation fits the link: send every 4th sample (50 Hz) and keep all 200 Hz in the on-board log. Plain decimation does not filter, so anything faster than half the new rate folds down: at 10 Hz a 6.5 Hz wobble is drawn as a slow 3.5 Hz one. Average or min/max per block first if you must go that low.',
    'Plot against the header stamp, not arrival time. The radio ships samples in 20 ms air frames, so they arrive in bunches, and a lost packet is resent 150 ms later, after newer ones. By arrival the line jitters and jumps back; by stamp it is smooth, and the gap at the right edge is the real lag.',
    'Spotting the bug: with Kp 5 and a 40 ms actuator delay, the measured speed rings around the setpoint at about 6.5 Hz and never settles, and the battery ripples with it. On the plot that is obvious in seconds; from print statements it is not. Lower Kp (or add D) and the ring is gone.',
  ],
  controls: [
    { kind: 'choice', key: 'ctrl', options: opts(CTRL), initial: 'hot' },
    { kind: 'choice', key: 'rate', options: opts(RATE), initial: 'r50' },
    { kind: 'choice', key: 'axis', options: opts(AXIS), initial: 'stamp' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const car = robotCar(scene, [-16, -3, 0], 0.6)
    const carX = car.group.position.x
    const queue = meterBar(scene, [-16, -7.4, 0], 5, TELE.queue, [[TELE.queue, 'full', HIGH_V]], 'TX queue')
    const pipeEnd: V3 = [-4.1, 4, 0]
    const pipe = topicPipe(scene, [car.antenna, [car.antenna[0], 4, 0], pipeEnd], '57.6 kbaud radio', B_FIELD, { r: 0.22, text: 0.45 })
    const packets = packetPool(scene, 16, 0.45)

    const speed = scope(scene, 17, 6, { divs: [10, 6], zeroAt: 1 / 6 })
    speed.group.position.set(5, 2.4, 0)
    const lower = scope(scene, 17, 4, { divs: [10, 4], zeroAt: 0 })
    lower.group.position.set(5, -5.3, 0)
    const sY = (v: number) => ((v - SPEED.lo) / (SPEED.hi - SPEED.lo) - 0.5) * speed.height
    const hY = (d: number) => (d / HD_MAX - 0.5) * lower.height
    const bY = (v: number) => ((v - BATT.lo) / (BATT.hi - BATT.lo) - 0.5) * lower.height
    const n = 2 * 200 * WINDOW + 40
    const tr = {
      sp: speed.trace(LABEL, { samples: n, radius: 0.06 }),
      v: speed.trace(HEAT, { samples: n, radius: 0.08 }),
      hd: lower.trace(B_FIELD, { samples: n, radius: 0.07 }),
      batt: lower.trace(POWER, { samples: n, radius: 0.07 }),
    }
    const late = [cursorBar(speed, HIGH_V, 0.08), cursorBar(lower, HIGH_V, 0.08)]
    const title = liveLabel(scene, [5, -9.6, 0.3], { size: 0.44 })
    addLabel(scene, 'speed 0 … 1 m/s', [13.5, 6.4, 0.3], GREY, 0.4, 'right')
    addLabel(scene, `heading 0 … ${HD_MAX}° · battery ${BATT.lo} … ${BATT.hi} V`, [13.5, -1.95, 0.3], GREY, 0.4, 'right')
    for (const [u, s] of [[0, `−${WINDOW} s`], [0.5, `−${WINDOW / 2} s`], [1, 'now']] as const) addLabel(scene, s, [5 + speed.xAt(u), -8.4, 0.3], GREY, 0.4)
    const note = liveLabel(scene, [-20, -10.8, 0.3], { size: 0.44, align: 'left' })
    const result = liveLabel(scene, [-20, -11.9, 0.3], { size: 0.44, align: 'left' })

    const clock = simClock(TELE.dt * 2, 2)
    const txS = TELE.sampleBytes / TELE.linkBps
    const buf = { us: [] as number[], sp: [] as number[], v: [] as number[], hd: [] as number[], batt: [] as number[] }
    const st = { t: 0, lag: 0, drops: 0, run: null as TeleFrame[] | null }
    return {
      scene,
      view: { center: [-3, -1, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const [c, every, axis] = plotParams(p)
        const run = runMemo(c)
        const { samples, dropped } = streamMemo([c, every])
        const now = Math.floor(clock(dt, `${c}${every}${axis}`, run.length - 1)) * TELE.dt
        st.t = now
        st.run = run
        const f = run[Math.round(now / TELE.dt)]
        car.group.position.x = carX + (f.v - f.sp) * 3

        const byStamp = axis === 'stamp'
        const shown = samples.filter((s) => s.arrive <= now && (byStamp ? s.stamp : s.arrive) >= now - WINDOW)
        if (byStamp) shown.sort((a, b) => a.stamp - b.stamp)
        for (const k of Object.keys(buf) as (keyof typeof buf)[]) buf[k].length = 0
        for (const s of shown) {
          const r = run[s.i]
          buf.us.push(1 - (now - (byStamp ? s.stamp : s.arrive)) / WINDOW)
          buf.sp.push(sY(r.sp))
          buf.v.push(sY(r.v))
          buf.hd.push(hY(r.hd))
          buf.batt.push(bY(r.batt))
        }
        tr.sp.points(buf.us, buf.sp)
        tr.v.points(buf.us, buf.v)
        tr.hd.points(buf.us, buf.hd)
        tr.batt.points(buf.us, buf.batt)
        const retry = shown.find((s) => s.retry)
        const ru = retry ? 1 - (now - (byStamp ? retry.stamp : retry.arrive)) / WINDOW : null
        late.forEach((l) => l(ru))
        const newest = shown.reduce((m, s) => Math.max(m, s.stamp), -Infinity)
        st.lag = Number.isFinite(newest) ? now - newest : 0
        st.drops = dropped.filter((d) => d <= now).length

        packets.begin()
        for (const s of samples) {
          if (s.sent - txS > now || s.arrive <= now) continue
          const u = s.sent > now ? 0 : (now - s.sent) / (s.arrive - s.sent)
          if (u > 0) packets.put(pipe.at(u), s.retry ? HIGH_V : HEAT, { w: 0.8, payload: 24 / TELE.sampleBytes })
        }
        packets.end()
        const q = txQueued(samples, now)
        queue(q, `${q}`, q >= TELE.queue ? HIGH_V : q > TELE.queue / 2 ? HEAT : POWER)

        title.set(`PlotJuggler · plotted by ${byStamp ? 'header stamp' : 'arrival time'} · ${hertz(streamHz(every))}`, LABEL)
        const load = streamLoad(every)
        note.set(load > 1 ? `Link ${Math.round(load * 100)} % full: queue backs up, ${st.drops} dropped` : `Link ${Math.round(load * 100)} % full: samples flow through`, load > 1 ? HIGH_V : POWER)
        const o = oscillation(run, 2, 3)
        result.set(
          o.pp > 0.05 ? `Bug: speed rings at ${hertz(o.hz)}${every === 20 ? `, plotted as ${hertz(Math.abs(aliasFrequency(o.hz, streamHz(every))))} (aliased)` : ''}` : 'Speed tracks the setpoint cleanly',
          o.pp > 0.05 ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const [c, every] = plotParams(p)
        const o = oscillation(runMemo(c), 2, 3)
        const load = streamLoad(every)
        return [
          { label: 'Sim time', value: `${st.t.toFixed(2)} s (½×)` },
          { label: 'Link', value: `${Math.round(load * 100)} %${st.drops ? ` · ${st.drops} lost` : ''}`, tone: load > 1 ? 'bad' : load > 0.7 ? 'warn' : 'ok' },
          { label: 'Plot lag', value: `${Math.round(st.lag * 1000)} ms`, tone: st.lag > 0.2 ? 'bad' : st.lag > 0.08 ? 'warn' : 'ok' },
          { label: 'Speed ripple', value: o.pp > 0.05 ? `${hertz(o.hz)} · ${o.pp.toFixed(2)} m/s` : 'none', tone: o.pp > 0.05 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Replay logs: a run logged on SD, scrubbed back to find an 80 ms wheel slip that caused a stall 4.7 s later. ---

const LOG_RATE = { r10: '10 Hz', r100: '100 Hz', r1k: '1 kHz' }
const HZ: Record<keyof typeof LOG_RATE, number> = { r10: 10, r100: 100, r1k: 1000 }
const FORMAT: Record<LogFormat, string> = { csv: 'CSV on SD', mcap: 'MCAP + zstd' }
const RUN = faultRun()
const logMemo = memoBy((hz: number) => `${hz}`, (hz) => logAt(RUN, hz))
const logParams = (p: Record<string, number | string>) => [HZ[pick(LOG_RATE, p.rate, 'r100')], pick(FORMAT, p.format, 'csv')] as const
const STALL = findStall(RUN)!
const SLIP_T = REPLAY.slip[0] * REPLAY.dt
const SLIP_X = RUN[REPLAY.slip[0]].x
const GZ = { lo: -0.5, hi: 2 }
const AMP_MAX = 3
const DOOR = (y: [number, number]) => ({ kind: 'box' as const, name: 'door post', x: REPLAY.door.x, y, h: 0.5, refl: 0.5 })
const ROOM = walledRoom(...REPLAY.room, 0.3, [DOOR([0, REPLAY.door.y[0]]), DOOR([REPLAY.door.y[1], REPLAY.room[1]])])
const perHour = (b: number) => `${((b * 3600) / 1048576).toFixed(1)} MB/h`

export const replayLogs: Lesson = {
  id: 'telemetry-logging-replay-logs',
  title: 'Replay logs',
  tagline: 'Record a run, then scrub back to the fault',
  formula: (p) => {
    const [hz, fmt] = logParams(p)
    const log = logMemo(hz)
    const b = logBytesPerS(fmt, hz, log)
    const s = findSlip(log)
    return `${hertz(hz)} × ${fmt === 'csv' ? `${Math.round(b / hz)} B/row` : `${Math.round(b / hz)} B/msg`} = ${bytesText(b)}/s = ${perHour(b)} · stall at ${STALL.t.toFixed(2)} s, cause ${s ? `logged at ${s.t.toFixed(3)} s` : 'between samples'}`
  },
  legend: [
    { color: B_FIELD, label: 'Gyro yaw rate', shape: 'dot' },
    { color: LABEL, label: 'Yaw rate from encoders', shape: 'dot' },
    { color: HEAT, label: 'Motor current', shape: 'dot' },
    { color: RING, label: 'Replay cursor', shape: 'dot' },
    { color: HIGH_V, label: 'Fault found in the log', shape: 'dot' },
  ],
  points: [
    'A log records every signal with its time stamp while the robot runs, so a fault can be studied afterwards instead of guessed at. On an ESP32 that is often CSV rows on an SD card; on ROS 2, `ros2 bag record` writes MCAP files (rosbag2) that Foxglove and PlotJuggler open directly.',
    `Replay reads the recorded rows back; it does not re-run the code. Drag the slider to scrub: the robot jumps to the logged pose at that time, interpolated between the two rows around it. The same log gives the same frame every time, so you can go back and forth over one moment until you understand it.`,
    `The symptom: the robot stalls against the door post at ${STALL.t.toFixed(1)} s (motor current jumps to ${REPLAY.stallA} A). The cause is ${(STALL.t - SLIP_T).toFixed(1)} s earlier: at ${SLIP_T.toFixed(2)} s the left wheel spins on a cable for 80 ms. The encoders read straight, the gyro sees a yaw spike, and the robot leaves the line by 10°.`,
    'Log rate decides what you can find. At 10 Hz the rows fall either side of the 80 ms slip: the heading steps but nothing explains it. At 100 Hz the gyro spike is there while both encoders agree: that is a slip. Log fast signals fast; slow ones (battery, temperature) can go at 1 Hz.',
    `Size grows with rate: a 3-decimal CSV row of 8 values is about 50 B, so 1 kHz is ~${perHour(logBytesPerS('csv', 1000, logMemo(100)))}. The ${bytesText(fsSize('default'))} LittleFS partition on the ESP32 would fill in minutes and wear its flash (Memory & storage → LittleFS); an SD card or a bag on the companion computer holds hours. MCAP adds a 31 B record header per message but compresses in chunks.`,
  ],
  controls: [
    { kind: 'choice', key: 'rate', options: opts(LOG_RATE), initial: 'r100' },
    { kind: 'choice', key: 'format', options: opts(FORMAT), initial: 'csv' },
    { kind: 'slider', key: 'at', label: 'Scrub', min: 0, max: REPLAY.seconds, initial: 0, step: 0.01, format: (v: number) => `${v.toFixed(2)} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const g = floorView(scene, [-21.5, -4.2, 0], 2.4, -0.5)
    roomModel(g, 0.6).draw(ROOM)
    cylinder(g, 0.015, 1.2, mat('#15161a', { rough: 0.6 }), [SLIP_X + 0.05, REPLAY.start[1], 0.015], 'y', 10)
    addLabel(g, 'cable', [SLIP_X + 0.05, REPLAY.start[1] - 0.75, 0.02], GREY, 0.16)
    const robot = lidarRobot(g, 1.2)
    const trail = pointCloud(g, 1400, 0.025)
    const found = add(g, new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 40), glowMat(HIGH_V, 1.3)))
    found.position.set(SLIP_X, REPLAY.start[1], 0.03)
    const rowNote = liveLabel(scene, [-21.5, -6.6, 0.3], { size: 0.42, align: 'left' })
    const verdict = liveLabel(scene, [-21.5, -7.7, 0.3], { size: 0.42, align: 'left' })

    const gyro = scope(scene, 14, 4.4, { divs: [7, 5], zeroAt: 0.2 })
    gyro.group.position.set(4, 3.5, 0)
    const amps = scope(scene, 14, 3.2, { divs: [7, 3], zeroAt: 0 })
    amps.group.position.set(4, -3.4, 0)
    const gY = (v: number) => ((v - GZ.lo) / (GZ.hi - GZ.lo) - 0.5) * gyro.height
    const aY = (v: number) => (v / AMP_MAX - 0.5) * amps.height
    const N = 700
    const tr = { gz: gyro.trace(B_FIELD, { samples: N, radius: 0.05 }), enc: gyro.trace(LABEL, { samples: N, radius: 0.08 }), amps: amps.trace(HEAT, { samples: N, radius: 0.07 }) }
    const cur = [cursorBar(gyro, RING, 0.12), cursorBar(amps, RING, 0.12)]
    const mark = liveLabel(scene, [0, 0.5, 0.3], { size: 0.4 })
    addLabel(scene, `yaw rate ${GZ.lo} … ${GZ.hi} rad/s`, [11, 6.6, 0.3], GREY, 0.4, 'right')
    addLabel(scene, `motor current 0 … ${AMP_MAX} A`, [11, -1.2, 0.3], GREY, 0.4, 'right')
    for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) addLabel(scene, `${s}`, [4 + gyro.xAt(s / REPLAY.seconds), -6.1, 0.3], GREY, 0.4)
    addLabel(scene, 's', [4 + gyro.xAt(1) + 0.8, -6.1, 0.3], GREY, 0.4)
    const file = meterBar(scene, [-1, -9, 0], 8, 1, [], 'log file')

    const st = { t: 0, at: NaN, hold: 0, key: '', row: null as LogRow | null }
    const us: number[] = []
    const ys: number[] = []
    const ys2: number[] = []
    const ys3: number[] = []
    return {
      scene,
      view: { center: [-4.5, -0.2, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const [hz, fmt] = logParams(p)
        const log = logMemo(hz)
        const at = Number(p.at)
        const key = `${hz}${fmt}`
        if (at !== st.at) Object.assign(st, { t: at, at, hold: 1.2 })
        if (key !== st.key) {
          st.key = key
          const stride = Math.max(1, Math.ceil(log.length / N))
          us.length = ys.length = ys2.length = ys3.length = 0
          for (let i = 0; i < log.length; i += stride) {
            const r = log[i]
            us.push(r.t / REPLAY.seconds)
            ys.push(gY(r.gz))
            ys2.push(gY((r.wr - r.wl) / REPLAY.track))
            ys3.push(aY(r.amps))
          }
          tr.gz.points(us, ys)
          tr.enc.points(us, ys2)
          tr.amps.points(us, ys3)
        }
        if (st.hold > 0) st.hold -= dt
        else st.t += dt
        if (st.t > REPLAY.seconds + 1.5) st.t = 0
        const t = Math.min(st.t, REPLAY.seconds)
        const r = replayAt(log, t)
        st.row = r
        robot.group.position.set(r.x, r.y, 0)
        robot.group.rotation.z = r.th
        if (r.amps < REPLAY.stallA * 0.9) robot.head.rotation.z -= dt * 12

        const stride = Math.max(1, Math.ceil(log.length / 1400))
        let k = 0
        for (let i = 0; i < log.length && log[i].t <= t; i += stride) trail.set(k++, [log[i].x, log[i].y, 0.02], log[i].t >= SLIP_T && log[i].t < STALL.t ? HEAT : GREY)
        trail.show(k)

        cur.forEach((c) => c(t / REPLAY.seconds))
        const slip = findSlip(log)
        const seen = slip && t >= slip.t
        mark.group.position.x = slip ? 4 + gyro.xAt(slip.t / REPLAY.seconds) : 0
        mark.set(slip ? 'slip ↑' : '', HIGH_V)
        found.visible = !!seen
        found.scale.setScalar(seen ? 1 + 0.15 * Math.sin(st.t * 6) : 1)

        const bps = logBytesPerS(fmt, hz, log)
        file(t / REPLAY.seconds, bytesText(bps * t), POWER)
        const i = log.findIndex((row) => row.t > t)
        rowNote.set(`Row ${i < 0 ? log.length : i} of ${log.length} · gz ${r.gz.toFixed(2)} rad/s · ${r.amps.toFixed(2)} A`, LABEL)
        verdict.set(
          t >= STALL.t
            ? slip
              ? `Stalled at ${STALL.t.toFixed(2)} s; cause logged at ${slip.t.toFixed(3)} s`
              : `Stalled at ${STALL.t.toFixed(2)} s; cause fell between rows`
            : seen
              ? `Yaw spike, encoders agree: left wheel slipped`
              : `Replaying the log (1× real time)`,
          t >= STALL.t ? (slip ? HEAT : HIGH_V) : seen ? HIGH_V : LABEL,
        )
      },
      readouts: (p) => {
        const [hz, fmt] = logParams(p)
        const log = logMemo(hz)
        const b = logBytesPerS(fmt, hz, log)
        const slip = findSlip(log)
        return [
          { label: 'Replay', value: `${Math.min(st.t, REPLAY.seconds).toFixed(2)} s` },
          { label: 'Log size', value: `${bytesText(b)}/s · ${perHour(b)}`, tone: b > 20000 ? 'warn' : 'ok' },
          { label: 'Cause', value: slip ? `slip at ${slip.t.toFixed(3)} s` : 'not in the log', tone: slip ? 'ok' : 'bad' },
          { label: 'Symptom', value: `stall at ${STALL.t.toFixed(2)} s`, tone: 'warn' },
        ]
      },
    }
  },
}
