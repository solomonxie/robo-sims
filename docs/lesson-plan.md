# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** → `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`). Id = entry id minus category, `/` → `-`.
- Numbers only from tested pure fns in `core/` (+ test). Circuits: `Element[]` → `core/nodal.ts` (`solveNodal`, `relaxSweep`, `theveninAt`); diodes via `diodeNode`/`ledStringAmps`. Formatters in `core/units.ts` (`secs`, `hertz`, `hexByte`, `hoursText`, …); param/control helpers (`n`, `pick`, `e12`, `resistorSlider`, `bitChoice`) in `lessons/types.ts`.
- Reuse `archive/lesson-drafts/`. Shared visuals in `lessons/fx/` (map below); grep before writing a helper.
- Framing: legend top ~30 % (right), chips bottom ~25 %, scene in the middle band, wide over tall.
- Visuals: `potentialColor` for levels; 3D text = `label()`/`partLetter` (stroke font, Q̄ = `'Q\u0304'`); 7-seg = `segmentDisplay`/`pulseLabel`; charges on `lane()`, speed ∝ current; `ease`/`glide` toward targets, `presence` to morph. Per-rebuild materials: `glowMat`/`new` (`emptyGroup` keeps cached `mat()`s). Heavy time-lapse solves: `memoBy(key, compute)`.
- Time-lapse: step tested fns, reset on control change, show sim time, ≤ 4 readouts, state the slow-down factor. Fields: retrace only on input change, log-scale decades, forces in screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; params/frames: `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}' frames=N`.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` (import `'../fx'`; model in brackets):
- `util` — `ease`/`glide`, `lerp`, `frac`, `path`, `emptyGroup`, `presence`, `halton`, `memoBy`, `peakToPeak`.
- `colors` — palette (`HEAT`, …), `glowMat`, `setGlow`, `potentialColor`.
- `shapes` — `arrow`, `plusGeometry`, `glowBox`.
- `text` — `label`, `addLabel` (shadowless, at a point), `liveLabel` (changing text) [`core/strokeFont`].
- `layout` — `wire`, `cableRun`, `LANE`/`lane`, `R_SCALE`/`RS`/`CELL_H`, `cellFraction`, `dropAlong`, `lieFlat`/`standUp`, `UNIT_ROD`/`stretchRod`.
- `circuit` — cell, bulb, R/D/LED, thermistor, ceramic, `chargeTank`, `terminal`/`junction`, switches, `icPackage`, `glowHalo`, `motorCan`, `resistorLoop`.
- `symbols` — ground, current/AC source, diode, op-amp.
- `parts` — real packages (TO-92/220, DIP-8, SOT-223, HC-49, fuse), `partLetter`, `litEpoxy`.
- `modules` — `tp4056Module`, `dcdcModule`, `sg90Servo`, `esp32Board` (face-on, `pin(i, top)`), `i2cBreakout` (sensor board, `pin(name)`) [`physics/power`].
- `cells` — `cellCutaway`, `cell18650`, `nickelStrip`, `cellPackModel` [`physics/power`].
- `boards` — `pcbStack` (layer stack, `via`), `flatTrace`, `flatText` [`physics/signals/pcb`].
- `electromech` — relay/SSR, switches, pot, `speaker`.
- `displays` — `segmentDisplay`, `pulseLabel`, `meterBar`, `multimeter`/`probe`, `phasor`, `clockFace`, `usbAnalyzer`.
- `screens` — `scope`, `ticks`, `ivScreen`, `benchScope` (DSO) [`physics/signals/scope`], `captureScreen` (analyser + decoder) [`physics/signals/buses`].
- `diagrams` — `timingDiagram`, `stateDiagram` [`core/fsm`].
- `mcu` — `codeBlock` (Arduino/ESP-IDF lines), `CODE_LEGEND`, `fetSymbol` (in-pin FET), `ledLoad`.
- `net` — `phoneModel`, `routerModel`, `robotCar` (ESP32 on the flank), `ripples`, `arcAt`, `packetPool` (header + payload blocks in flight) [`physics/wireless`].
- `logic` — `gateSymbol`, `signalWire`/`litWire`, `inBall`, `ledOut`, `bitRow`, `gateNet`, `flipFlopBlock`, `LOGIC_WIRES` [`core/logic`].
- `flows` — `Flow`, electron gas, ion lattice, `plusFlow`, `loopBeads`.
- `heat`, `crystal`, `dies`, `fields`, `plots`, `story` (stepped lessons).

`core/physics/` by domain (`gpio`: pad drivers, pulls, polling; `uart`: framing/parity, 16× receiver, TTL/RS-232/RS-485 links, NMEA; `pwm`: LEDC bits, ripple, switching loss, servo; `adc`: SAR steps, quantise, noise/averaging, ESP32 attenuation curves; `dac`: R-2R solve, held tones, RC/PWM reconstruction; `i2c`: addresses, scan, pull-up rise, MPU-6050 burst; `spi`: shift ring, shared MISO, TFT/SD throughput; `can`: differential link + terminations, arbitration, frames (CRC-15, stuffing); `wireless`: Wi-Fi STA/AP hops + rates, HTTP vs WebSocket cost, BLE GATT read/notify, ESP-NOW airtime/retries; register-read frames in `signals/buses`); subfolders `power/` (batteries … brownout) and `signals/` (filters, fourier, scope, buses, transmission, radio, interference, pcb).

## Pacing

- Serial: one agent at a time; next starts only after the last finishes.
- Gate before each spawn: memory pressure = 1, free disk > 20 GB, loadavg(1m) < 25 for one agent (raised from 15: background load from other apps sat at ~20 for hours; agent work is niced) (< 10 for two). Else wait for the hourly check.
- After each section (category) is done: one cleanup agent before the next topic — split/dedupe shared code (`lessons/fx/`, `core/`), drop dead code, compact this file and `DESIGN.md`. No behaviour change.
- Hourly check: read git log + this file, check load; speed up (2 agents in parallel, on different categories) only if the Mac is idle and the last runs were clean; pause on red tests or overload.
- Builds/tests run with `nice -n 10`.
- Install on the iPhone only once the whole queue is done (not per topic), from the clean worktree `/tmp/robo-sims-install` (`git checkout --detach <hash>`, then `nice -n 10 make ios-build ios-run`), so agents' uncommitted edits never get bundled. Its `node_modules` is an APFS clone (`/bin/cp -cR`); a symlink breaks Metro.

## Queue

Order follows the drafts backlog, then the home sections. Tick when committed.

- Wave 1 Electricity ✓ 12/12
- Wave 2 Components & semiconductors ✓ 20/20
- Wave 3 Digital, Power, Signals ✓ 24/24

### Wave 4 — Microcontrollers, Sensors, Software
- Microcontrollers:
  - [x] GPIO
  - [x] PWM
  - [x] ADC
  - [x] DAC
  - [x] Timers & interrupts
  - [x] UART serial
  - [x] I²C
  - [x] SPI
  - [x] CAN bus
  - [x] Wi-Fi & Bluetooth
  - [ ] Power modes
  - [ ] Memory & storage
  - [ ] RTOS basics
  - [ ] Bootloader & flashing
- Sensors:
  - [ ] Ultrasonic
  - [ ] Infrared
  - [ ] Time-of-flight laser
  - [ ] LiDAR
  - [ ] Encoder
  - [ ] IMU
  - [ ] Magnetometer
  - [ ] GPS
  - [ ] Camera
  - [ ] Temperature & humidity
  - [ ] Current & voltage sensing
  - [ ] Force & touch
  - [ ] Microphone & sound
  - [ ] Sensor fusion
- Software:
  - [ ] Firmware structure
  - [ ] ROS 2 concepts
  - [ ] TF & URDF
  - [ ] Nav2
  - [ ] micro-ROS
  - [ ] Simulation
  - [ ] Behaviour trees
  - [ ] Telemetry & logging
  - [ ] Remote control
  - [ ] Safety & failsafes

### Later waves (file order within each)
- Wave 5: Actuators, Mobility, Control, Kinematics, Perception, Navigation, AI
- Wave 6: Mechanics, Waves, Math, Materials, Printing
- Wave 7: Practice (projects, challenges, debugging, workshop)
