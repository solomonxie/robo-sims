# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** → `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`). Id = entry id minus category, `/` → `-`.
- Numbers only from tested pure fns in `core/` (+ test). Circuits: `Element[]` → `core/nodal.ts` (`solveNodal`, `relaxSweep`, `theveninAt`); diodes via `diodeNode`/`ledStringAmps`. Formatters in `core/units.ts` (`secs`, `hertz`, `hexByte`, `msText`, `mAText`, `dbmText`, `hoursText`, `spanText`, `bytesText`, …) and `core/numbers.ts` (`binary`, `hex`); param/control helpers (`n`, `pick`, `e12`, `resistorSlider`, `bitChoice`) in `lessons/types.ts`.
- Reuse `archive/lesson-drafts/`. Shared visuals in `lessons/fx/` (map below); grep before writing a helper.
- Framing: legend top ~30 % (right), chips bottom ~25 %, scene in the middle band, wide over tall.
- Visuals: `potentialColor` for levels; 3D text = `label()`/`partLetter` (stroke font, Q̄ = `'Q\u0304'`); 7-seg = `segmentDisplay`/`pulseLabel`; charges on `lane()`, speed ∝ current; `ease`/`glide` toward targets, `presence` to morph. Per-rebuild materials: `glowMat`/`new` (`emptyGroup` keeps cached `mat()`s). Heavy time-lapse solves: `memoBy(key, compute)`.
- Time-lapse: step tested fns, reset on control change, show sim time, ≤ 4 readouts, state the slow-down factor. Fields: retrace only on input change, log-scale decades, forces in screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; params/frames: `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}' frames=N`.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` (import `'../fx'`; model in brackets):
- `util` — `ease`/`glide`, `lerp`, `frac`, `path`, `emptyGroup`, `presence`, `halton`, `memoBy`, `peakToPeak`.
- `colors` — palette (`HEAT`, `INK`, …), `glowMat`, `setGlow`, `potentialColor`.
- `shapes` — `arrow`, `plusGeometry`, `glowBox`, `flatBox` (shadowless), `trayMat`.
- `text` — `label`, `addLabel` (shadowless, at a point), `liveLabel` (changing text) [`core/strokeFont`].
- `layout` — `wire`, `cableRun`, `LANE`/`lane`, `R_SCALE`/`RS`/`CELL_H`, `cellFraction`, `dropAlong`, `lieFlat`/`standUp`, `UNIT_ROD`/`shadowlessRod`/`stretchRod`.
- `circuit` — cell, bulb, R/D/LED, thermistor, ceramic, `chargeTank`, `terminal`/`junction`, switches, `icPackage`, `glowHalo`, `motorCan`, `resistorLoop`.
- `symbols` — ground, current/AC source, diode, op-amp.
- `parts` — real packages (TO-92/220, DIP-8, SOT-223, HC-49, fuse), `partLetter`, `litEpoxy`.
- `modules` — `tp4056Module`, `dcdcModule`, `sg90Servo`, `esp32Board` (face-on, `pin(i, top)`), `i2cBreakout` (sensor board, `pin(name)`) [`physics/power`].
- `cells` — `cellCutaway`, `cell18650`, `nickelStrip`, `cellPackModel` [`physics/power`].
- `boards` — `pcbStack` (layer stack, `via`), `flatTrace`, `flatText` [`physics/signals/pcb`].
- `electromech` — relay/SSR, switches, pot, `speaker`.
- `displays` — `segmentDisplay`, `pulseLabel`, `meterBar`, `multimeter`/`probe`, `phasor`, `clockFace`, `usbAnalyzer`.
- `sensing` — `hcSr04` (aimed in the screen plane, → T/R), `beamCone`, `wavePool` (wavefront arcs, wall-clipped) [`physics/sensors`].
- `screens` — `scope`, `ticks`, `ivScreen`, `benchScope` (DSO) [`physics/signals/scope`], `captureScreen` (analyser + decoder), `I2C_TEXT` [`physics/signals/buses`].
- `diagrams` — `timingDiagram`, `stateDiagram` [`core/fsm`].
- `mcu` — `codeBlock` (Arduino/ESP-IDF lines), `CODE_LEGEND`, `PIN_COLOR`, `IDLE`, `fetSymbol` (in-pin FET), `ledLoad`.
- `net` — `phoneModel`, `routerModel`, `robotCar` (ESP32 on the flank), `ripples`, `arcAt`, `packetPool` (header + payload blocks in flight) [`physics/mcu/wireless`].
- `logic` — `gateSymbol`, `signalWire`/`litWire`, `inBall`, `ledOut`, `bitRow`, `gateNet`, `flipFlopBlock`, `LOGIC_WIRES` [`core/logic`].
- `flows` — `Flow`, electron gas, ion lattice, `plusFlow`, `loopBeads`.
- `heat`, `crystal`, `dies`, `fields`, `plots`, `story` (stepped lessons).

`core/physics/` (flat files: dc, ac, circuits, semiconductors, … timing, levels) + subfolders:
- `power/` — batteries, packs, charging, converters, budget, wiring, noise, brownout.
- `signals/` — filters, fourier, scope, buses (I²C/SPI/register frames), transmission, radio, interference, pcb.
- `mcu/` (ESP32) — `gpio` pads/pulls/polling; `pwm` LEDC/ripple/servo; `adc` SAR/noise/attenuation; `dac` R-2R/tones/reconstruction; `timers` alarms/ISRs/millis; `uart` framing/links/NMEA; `i2c` addresses/pull-ups/MPU-6050; `spi` shift ring/MISO/TFT+SD; `can` link/arbitration/frames; `wireless` Wi-Fi/HTTP vs WS/BLE/ESP-NOW; `sleep` domains/wake/battery years; `memory` partitions/stack+heap/flash wear; `rtos` two-core tick scheduler; `boot` straps/esptool/OTA.
- `sensors/` — `ultrasonic` speed of sound/echo timing/beam gain/mirror-image echoes/soft targets.

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
- Microcontrollers ✓ 14/14
- Sensors:
  - [x] Ultrasonic
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
