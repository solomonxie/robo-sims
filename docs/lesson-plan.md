# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** → `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`). Id = entry id minus category, `/` → `-`.
- Numbers only from tested pure fns in `core/` (+ test); `core/physics` is one flat namespace (unique names). Circuits: `Element[]` → `core/nodal.ts` (`solveNodal`, `relaxSweep`, `theveninAt`), diodes via `diodeNode`/`ledStringAmps`. Formatters: `core/units.ts` (`secs`, `msText`, `bytesText`, `signed`, …), `core/numbers.ts`. Controls: `lessons/types.ts` (`n`, `pick`, `opts`, `e12`, `resistorSlider`, `bitChoice`).
- Reuse `archive/lesson-drafts/`. Shared visuals in `lessons/fx/` (map below); grep before writing a helper.
- Framing: legend top ~30 % (right), chips bottom ~25 %, scene in the middle band, wide over tall.
- Visuals: `potentialColor` for levels; 3D text = `label()`/`partLetter` (stroke font, Q̄ = `'Q\u0304'`); 7-seg = `segmentDisplay`/`pulseLabel`; charges on `lane()`, speed ∝ current; `ease`/`glide` toward targets, `presence` to morph. Per-rebuild materials: `glowMat`/`new` (`emptyGroup` keeps cached `mat()`s). Heavy time-lapse solves: `memoBy(key, compute)`.
- Robot frames: body X forward, Y left, Z up; pitch > 0 = nose up; heading clockwise from north (`tiltAccel`, `bodyAccel`, `toBody`).
- Time-lapse: step tested fns, reset on control change, show sim time, ≤ 4 readouts, state the slow-down factor. Fields: retrace only on input change, log-scale decades, forces in screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; params/frames: `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}' frames=N`.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` (import `'../fx'`; model in brackets):
- `util` — `ease`/`glide`, `lerp`, `frac`, `smoothstep`, `sineHash`, `add3`, `path`, `emptyGroup`, `presence`, `halton`, `memoBy`, `peakToPeak`.
- `colors` — palette (`HEAT`, `INK`, …), `glowMat`, `setGlow`, `potentialColor`, `toneColor` (readout tone → colour).
- `shapes` — `arrow`, `plusGeometry`, `glowBox`, `flatBox` (shadowless), `trayMat`, `shellMat` (see-through housing).
- `text` — `label`, `addLabel` (shadowless, at a point), `liveLabel` (changing text), `textLines` (3 lines + status) [`core/strokeFont`].
- `layout` — `wire`, `cableRun`, `LANE`/`lane`, `R_SCALE`/`RS`/`CELL_H`, `cellFraction`, `dropAlong`, `lieFlat`/`standUp`, `UNIT_ROD`/`shadowlessRod`/`stretchRod`, `addRod`, `rodBetween`.
- `circuit` — cell, bulb, R/D/LED, thermistor, ceramic, `chargeTank`, `terminal`/`junction`, switches, `icPackage`, `glowHalo`, `motorCan`, `resistorLoop`.
- `symbols` — ground, current/AC source, diode, op-amp.
- `parts` — real packages (TO-92/220, DIP-8, SOT-223, HC-49, fuse), `partLetter`, `litEpoxy`.
- `modules` — `tp4056Module`, `dcdcModule`, `sg90Servo`, `stepDriver` (A4988/TMC2209, `pin(name, side)`, `trim`), `esp32Board` (face-on, `pin(i, top)`), `esp32Cam` (OV2640 lens, `lens()`, `iris`), `i2cBreakout` (sensor board, `pin(name)`) [`physics/power`].
- `cells` — `cellCutaway`, `cell18650`, `cellPackModel` [`physics/power`].
- `boards` — `pcbStack` (layer stack, `via`), `flatTrace`, `flatText` [`physics/signals/pcb`].
- `electromech` — relay/SSR, `speaker`.
- `motors` — `brushedMotor` (cut open: magnets, 3-slot armature, commutator + brushes; `set(angle, level, heat)`), `nema17` (8 poles, 50-tooth rotor; `set(angle, ia, ib)`), `bldcMotor` (outrunner, 6 teeth, 2-pole bell, opt. Halls; `set(angle, [ia, ib, ic])`), `spurGear` (opt. tooth `thick`), `ringGear` (internal), `gearTrain`, `sectorGeometry`, `leadScrew` (nut + threads, `set(y)` turns it) [`physics/electromechanical`, `physics/gearing`, `physics/stepper`, `physics/bldc`].
- `switches` — tact/toggle switches, pot, `estopButton` (NC mushroom), `microSwitch` (lever, COM/NC/NO; `microSwitchReach`), cut open.
- `displays` — `segmentDisplay`, `pulseLabel`, `meterBar`, `multimeter`/`probe`, `phasor`, `clockFace`, `usbAnalyzer`.
- `sensing` — `hcSr04` (aimed in the screen plane, → T/R), `beamCone`, `wavePool` (wavefront arcs, wall-clipped), `lightRay` (beads along a polyline), `pixelGrid` (instanced sensor pixels, sRGB `set`), `IR_TINT`, `SUN_TINT` [`physics/sensors`].
- `screens` — `scope` (`trace.points` = polyline in any order), `ticks`, `ivScreen`, `benchScope` (DSO) [`physics/signals/scope`], `cursorBar` (time cursor on a scope), `captureScreen` (analyser + decoder), `I2C_TEXT` [`physics/signals/buses`].
- `rooms` — `floorView` (tilted top-view group), `roomModel` (solids from `Room`, metres, caller scales/turns), `lidarRobot` (spinning head), `pointCloud` (instanced dots), `rayFan` (instanced rods), `costField` (costmap height bars), `floorMat` (floor with 0.5 m tape), `crashWall` [`physics/room`, `software/costmap`].
- `diagrams` — `timingDiagram`, `stateDiagram` [`core/fsm`], `gantt` (per-tick rows, `rebuild`/`show(now)`), `simClock` (looping time-lapse clock), `moduleBlock` (glowing node/code slab), `btDiagram` (behaviour tree lit by status) [`software/btree`].
- `mcu` — `codeBlock` (Arduino/ESP-IDF lines; `rosTint` + `ROS_CODE_LEGEND` for rclpy/rclcpp/CLI), `CODE_LEGEND`, `PIN_COLOR`, `IDLE`, `fetSymbol` (in-pin FET), `ledLoad`.
- `frames` — `frameTriad` (RGB axes), `setTf` (4×4 onto an object), `urdfModel` (links from a parsed URDF, `pose(q)`) [`physics/software/urdf`].
- `net` — `phoneModel`, `routerModel`, `robotCar` (ESP32 on the flank), `ripples`, `arcAt`, `packetPool` (header + payload blocks in flight), `topicPipe` (named ROS topic, `at(u)`) [`physics/mcu/wireless`, `physics/software`].
- `logic` — `gateSymbol`, `signalWire`/`litWire`, `inBall`, `ledOut`, `bitRow`, `gateNet`, `flipFlopBlock`, `LOGIC_WIRES` [`core/logic`].
- `flows` — `Flow`, electron gas, ion lattice, `plusFlow`, `loopBeads`.
- `heat`, `crystal`, `dies`, `fields`, `plots`, `story` (stepped lessons).

`core/physics/` (flat files: dc, ac, circuits, semiconductors, … timing, levels) + subfolders:
- `power/` — batteries, packs, charging, converters, budget, wiring, noise, brownout.
- `signals/` — filters, fourier, scope, buses (I²C/SPI/register frames), transmission, radio, interference, pcb.
- `mcu/` (ESP32) — gpio, pwm, adc, dac, timers, uart, i2c, spi, can, wireless, sleep, memory, rtos, boot, firmware (super-loop vs tasks, driver layers, fixed-rate loop).
- `software/`:
  - `messaging` — pub/sub QoS, service vs action, launch respawn.
  - `urdf` — 4×4 `tf3`/`mul4`/`invert4`, `parseUrdf`, `urdfTree`, `linkFrames`, `ROVER`.
  - `frames` — `compose2`/`invert2`, drifting `odomPose`, `tfChain`.
  - `costmap` — layers, `inflate`, A* `planGrid`, `costmapRun`.
  - `btree` — `btTick` (+ decorators), Nav2 `NAV_TREE`/`btNavRun`.
  - `fetchbot` — fetch robot `fetchRun` vs `FETCH_FSM`, blackboard `bbRun`.
  - `microros` — agent reconnect `urosRun`, XRCE over UART/UDP `xrceRun`.
  - `telemetry` — `speedRun`/`streamRun` over radio, `faultRun` log, `replayAt`.
  - `simulation` — box engine `physStep`/`physRun`, sim-vs-real `twinRun`/`tuneTwin`.
  - `remote` — `stickToWheels`, BLE `joyRun`, WebSocket `wsRun`, `lagRun`/`safeSpeed`.
  - `safety` — WDT `wdtRun`, E-stop `estopRun`, fault FSM `faultFsmRun`.
- `sensors/` — `ultrasonic`, `infrared`, `tof`, `lidar`, `encoder` (`odoStep`), `imu`, `magnetometer` (`toBody`), `gps`, `camera`, `temperature`, `current` (`socRun`), `force`, `microphone` (TDOA `locate`), `fusion` (`kfPredict`/`kfUpdate`, `fuseRun`).
- `common.ts` — `LIGHT_C`, `SOUND_C`, `DEG`/`toDeg`, `clamp`/`clamp01`, `fixedStepAt`, `wrapPi`/`wrap2pi`, `hash01`, `gaussAt` (repeatable noise).
- `room.ts` — walled rooms, `castRoom`, robot `Pose` (x, y, th) + `toRoom`, `shuttle`: shared by mobile-robot lessons.

## Pacing

- Serial: one agent at a time; next starts only after the last finishes.
- Gate before each spawn: memory pressure = 1, free disk > 20 GB, loadavg(1m) < 25 for one agent (< 10 for two). Else wait for the hourly check.
- After each section (category) is done: one cleanup agent before the next topic — split/dedupe shared code (`lessons/fx/`, `core/`), drop dead code, compact this file and `DESIGN.md`. No behaviour change.
- Hourly check: read git log + this file, check load; speed up (2 agents in parallel, on different categories) only if the Mac is idle and the last runs were clean; pause on red tests or overload.
- Builds/tests run with `nice -n 10`.
- Install on the iPhone only once the whole queue is done (not per topic), from the clean worktree `/tmp/robo-sims-install` (`git checkout --detach <hash>`, then `nice -n 10 make ios-build ios-run`), so agents' uncommitted edits never get bundled. Its `node_modules` is an APFS clone (`/bin/cp -cR`); a symlink breaks Metro.

## Queue

Order follows the drafts backlog, then the home sections. Tick when committed.

- Wave 1 Electricity ✓ 12/12
- Wave 2 Components & semiconductors ✓ 20/20
- Wave 3 Digital, Power, Signals ✓ 24/24
- Wave 4 Microcontrollers, Sensors, Software ✓ 38/38


### Wave 5 — Actuators, Mobility, Control, Kinematics, Perception, Navigation, AI
- Actuators:
  - [x] DC motor
  - [x] H-bridge
  - [x] Servo
  - [x] Stepper
  - [x] Brushless (BLDC)
  - [x] Field-oriented control
  - [x] Linear actuators
  - [x] Solenoids & pumps
  - [x] Gear trains
  - [x] Pneumatics & soft robots
  - [x] Motor selection
- Mobility:
  - [ ] Differential drive
  - [ ] Mecanum wheels
  - [ ] Omni & swerve
  - [ ] Ackermann steering
  - [ ] Tracks & terrain
  - [ ] Legged walking
  - [ ] Balancing robots
  - [ ] Drones & flight
  - [ ] Underwater & swimming
- Control:
  - [ ] Open vs closed loop
  - [ ] Bang-bang & hysteresis
  - [ ] PID
  - [ ] Speed control
  - [ ] Position control
  - [ ] Line following
  - [ ] Stability
  - [ ] State-space & LQR
  - [ ] Model predictive control
  - [ ] Filters in the loop
- Kinematics:
  - [ ] Coordinate frames
  - [ ] Forward kinematics
  - [ ] Inverse kinematics
  - [ ] Jacobian
  - [ ] Workspace
  - [ ] Trajectories
  - [ ] Grippers
  - [ ] Robot arm build
  - [ ] Dynamics
- Perception:
  - [ ] Image basics
  - [ ] Edges & features
  - [ ] Colour tracking
  - [ ] Camera model
  - [ ] Fiducial markers
  - [ ] Object detection
  - [ ] Depth sensing
  - [ ] Optical flow
  - [ ] Occupancy grids
- Navigation:
  - [ ] Odometry
  - [ ] Obstacle avoidance
  - [ ] Maze solving
  - [ ] Graph search
  - [ ] Sampling planners
  - [ ] Path tracking
  - [ ] Localization
  - [ ] SLAM
  - [ ] Swarm & multi-robot
- AI:
  - [ ] Neural nets 101
  - [ ] TinyML
  - [ ] Reinforcement learning
  - [ ] Imitation learning
  - [ ] Vision-language models
  - [ ] Speech & wake words
  - [ ] Anomaly detection

### Later waves (file order within each)
- Wave 6: Mechanics, Waves, Math, Materials, Printing
- Wave 7: Practice (projects, challenges, debugging, workshop)
