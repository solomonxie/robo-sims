# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** → `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`). Id = entry id minus category, `/` → `-`.
- Numbers only from tested pure fns in `core/` (+ test); `core/physics` is one flat namespace (unique names); inside it import files, not folder `index`es (cycles). Circuits: `Element[]` → `core/nodal.ts` (`solveNodal`, `relaxSweep`, `theveninAt`), diodes via `diodeNode`/`ledStringAmps`. Formatters: `core/units.ts` (`secs`, `msText`, `pct`, `bytesText`, `signed`, …), `core/numbers.ts`. Controls: `lessons/types.ts` (`n`, `pick`, `opts`, `e12`, `resistorSlider`, `bitChoice`).
- Reuse `archive/lesson-drafts/`. Shared visuals in `lessons/fx/` (map below); grep before writing a helper.
- Framing: legend top ~30 % (right), chips bottom ~25 %, scene in the middle band, wide over tall.
- Visuals: `potentialColor` for levels; 3D text = `label()`/`partLetter` (stroke font, Q̄ = `'Q\u0304'`); 7-seg = `segmentDisplay`/`pulseLabel`; charges on `lane()`, speed ∝ current; `ease`/`glide` toward targets, `presence` to morph. Per-rebuild materials: `glowMat`/`new` (`emptyGroup` keeps cached `mat()`s). Heavy time-lapse solves: `memoBy(key, compute)`.
- Robot frames: body X forward, Y left, Z up; pitch > 0 = nose up; heading clockwise from north (`tiltAccel`, `bodyAccel`, `toBody`).
- Time-lapse: step tested fns, reset on control change, show sim time, ≤ 4 readouts, state the slow-down factor. Fields: retrace only on input change, log-scale decades, forces in screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; params/frames: `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}' frames=N`.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` (import `'../fx'`; model in brackets):
- `util` — `ease`/`glide`, `lerp`, `frac`, `smoothstep`, `sineHash`, `add3`, `path`, `emptyGroup`, `presence`, `halton`, `memoBy`, `peakToPeak`.
- `colors` — palette (`HEAT`, `INK`, …), `lit` (THREE.Color), `glowMat`, `setGlow`, `potentialColor`, `toneColor` (readout tone → colour).
- `shapes` — `arrow`, `stretchArrow` (any length a→b), `plusGeometry`, `glowBox`, `flatBox` (shadowless), `trayMat`, `shellMat` (see-through housing), `sectorGeometry`.
- `text` — `label`, `addLabel` (shadowless, at a point), `liveLabel` (changing text), `textLines` (3 lines + status) [`core/strokeFont`].
- `layout` — `wire`, `cableRun`, `LANE`/`lane`, `R_SCALE`/`RS`/`CELL_H`, `cellFraction`, `dropAlong`, `lieFlat`/`standUp`, `UNIT_ROD`/`shadowlessRod`/`stretchRod`, `addRod`, `rodBetween`.
- `circuit` — cell, bulb, R/D/LED, thermistor, ceramic, `chargeTank`, `terminal`/`junction`, switches, `icPackage`, `glowHalo`, `motorCan`, `resistorLoop`.
- `symbols` — ground, current/AC source, diode, op-amp.
- `parts` — real packages (TO-92/220, DIP-8, SOT-223, HC-49, fuse), `partLetter`, `litEpoxy`.
- `modules` — `tp4056Module`, `dcdcModule`, `sg90Servo`, `stepDriver` (A4988/TMC2209, `pin(name, side)`, `trim`), `esp32Board` (face-on, `pin(i, top)`), `esp32Cam` (OV2640 lens, `lens()`, `iris`), `i2cBreakout` (sensor board, `pin(name)`) [`physics/power`].
- `cells` — `cellCutaway`, `cell18650`, `cellPackModel` [`physics/power`].
- `boards` — `pcbStack` (layer stack, `via`), `flatTrace`, `flatText` [`physics/signals/pcb`].
- `electromech` — relay/SSR, `speaker`.
- `motors` — `brushedMotor` (cut open; `set(angle, level, heat)`), `nema17` (`set(angle, ia, ib)`), `bldcMotor` (outrunner, opt. Halls; `set(angle, [ia, ib, ic])`), `PHASE_COLORS` [`physics/actuators`].
- `gears` — `spurGear`, `ringGear`, `gearTrain`, `leadScrew` (`set(y)` turns it), `gearPlastic`/`gearBrass` [`physics/actuators`].
- `switches` — tact/toggle switches, pot, `estopButton` (NC mushroom), `microSwitch` (lever, COM/NC/NO; `microSwitchReach`), cut open.
- `displays` — `segmentDisplay`, `pulseLabel`, `meterBar`, `multimeter`/`probe`, `phasor`, `clockFace`, `usbAnalyzer`.
- `sensing` — `hcSr04` (aimed in the screen plane, → T/R), `beamCone`, `wavePool` (wavefront arcs, wall-clipped), `lightRay` (beads along a polyline), `pixelGrid` (instanced sensor pixels, sRGB `set`), `IR_TINT`, `SUN_TINT` [`physics/sensors`].
- `screens` — `scope` (`trace.points` = polyline in any order), `ticks`, `ivScreen`, `benchScope` (DSO) [`physics/signals/scope`], `cursorBar` (time cursor on a scope), `captureScreen` (analyser + decoder), `I2C_TEXT` [`physics/signals/buses`].
- `rooms` — `floorView` (tilted top-view group), `roomModel` (solids from `Room`, metres, caller scales/turns), `lidarRobot` (spinning head), `pointCloud` (instanced dots), `rayFan` (instanced rods), `costField` (costmap height bars), `floorMat` (floor with 0.5 m tape), `floorTrail` (dots behind a robot), `crashWall` [`physics/room`, `software/costmap`].
- `diagrams` — `timingDiagram`, `stateDiagram` [`core/fsm`], `gantt` (per-tick rows, `rebuild`/`show(now)`), `simClock` (looping time-lapse clock), `moduleBlock` (glowing node/code slab), `btDiagram` (behaviour tree lit by status) [`software/btree`].
- `mcu` — `codeBlock` (Arduino/ESP-IDF lines; `rosTint` + `ROS_CODE_LEGEND` for rclpy/rclcpp/CLI), `CODE_LEGEND`, `PIN_COLOR`, `IDLE`, `fetSymbol` (in-pin FET), `ledLoad`.
- `frames` — `frameTriad` (RGB axes), `setTf` (4×4 onto an object), `urdfModel` (links from a parsed URDF, `pose(q)`) [`physics/software/urdf`].
- `wheeled` — `diffBot` (top-view TT two-wheeler in metres, `set(pose, dL, dR)`, `slip(l, r)`, `ghost` outline for estimates), `mecanumBot` (four 60 mm mecanum wheels, `set(pose, travel[4])`, `layout`, `slip`), `mecanumWheel`, `omniWheel`/`omniBot` (kiwi/X, `set(pose, travel, side)`), `swerveBot` (FRC, `set(pose, angles, travel)`, `glow`), `rcCar` (1/10 Ackermann car, servo linkage, `set(pose, [l, r], travel[4])`, `arms(beta)`, `scrub`), `trackedBot` (sprockets, idlers, moving links; `wheels` = 4WD twin; `set(pose, l, r)`, `body` for sink/pitch, `scuff`, `spin`), `balanceBot` (side-view ESP32 + MPU-6050 self-balancer, `set(tilt, roll)`, `balanceBotHeight`) [`physics/mobility`].
- `aerial` — `quadcopter` (5" X quad, `pose(roll, pitch, yaw)`, `set(spin, share, clipped)` props + thrust arrows), `spinArc` (curved arrow), `SPIN_COLORS` [`physics/mobility/quadcopter`].
- `legged` — `servoWalker` (hexapod/quadruped, 3 SG90s per leg, `set(pose, angles, down)`), `servoBiped` (`set(lean, tip)` rolls over toe/heel) [`physics/mobility/legged`].
- `net` — `phoneModel`, `routerModel`, `robotCar` (ESP32 on the flank), `stickPhone` (thumbstick, `stick(x, y)`), `ripples`, `arcAt`, `packetPool` (header + payload blocks in flight), `topicPipe` (named ROS topic, `at(u)`) [`physics/mcu/wireless`, `physics/software`].
- `logic` — `gateSymbol`, `signalWire`/`litWire`, `inBall`, `ledOut`, `bitRow`, `gateNet`, `flipFlopBlock`, `LOGIC_WIRES` [`core/logic`].
- `flows` — `Flow`, electron gas, ion lattice, `plusFlow`, `loopBeads`.
- `heat`, `crystal`, `dies`, `fields`, `plots`, `story` (stepped lessons).

`core/physics/` (flat files: dc, ac, circuits, semiconductors, electromechanical (relays, switches, pots), … timing, levels) + subfolders:
- `power/` — batteries, packs, charging, converters, budget, wiring, noise, brownout.
- `signals/` — filters, fourier, scope, buses (I²C/SPI/register frames), transmission, radio, interference, pcb.
- `mcu/` (ESP32) — gpio, pwm, adc, dac, timers, uart, i2c, spi, can, wireless, sleep, memory, rtos, boot, firmware (super-loop vs tasks, driver layers, fixed-rate loop).
- `software/` — messaging (QoS, actions), urdf (`tf3`, `parseUrdf`, `ROVER`), frames (`odomPose`, `tfChain`), costmap (`inflate`, A* `planGrid`), btree (`btTick`, `NAV_TREE`), fetchbot, microros, telemetry, simulation (`physStep`, `twinRun`), remote (`stickToWheels`), safety (`wdtRun`, `estopRun`).
- `mobility/` — diffdrive (`diffForward`/`diffInverse`, `turnRadius`, `iccOf`, exact `diffStep`, UMBmark `squareRun`, `slipRun`, `FLOORS`), mecanum (`mecInverse`/`mecForward`, `mecForceSum`, `mecScale`, `twistStep`, `mecRun`, `fitTwist`), omni (`omniInverse`/`omniForward`, `holoTopSpeed`), swerve (`swerveStates`, `swerveOptimize`, `swerveTick`, `swerveFit`), ackermann (`steerAngles`, `axleHits`, `frontSlip`, `minTurn`, `wheelSpeeds`, `bicycleStep`, `pursuitRun`, `polyPath`, `parkPlan`), tracks (`TANK`, `TERRAINS`, `turnMoment`, `steerLimit`, Janosi `slipFor`, `skidRun`, Bekker `plateSink`/`wheelSink`, `peakThrust`, `softPull`, `tipAngle`, `climbLimit`), legged (`GAITS`, `legPhase`, `footPath`, `gaitFeet`, `supportHull`/`hullMargin`, `legIK`/`legFK`/`legAngles`, `zmpX`, `zmpRun`), balance (cart-pole `cartStep`, `torqueLimit` (back-EMF), discrete `pidStep`, cascaded `balanceLoop`, `fallTime`, `comOffset`), quadcopter (`mix`/`MIX`, `quadWrench`, `quadBodyStep`, `hoverThrottle`, `thrustToWeight`, cascaded `attitudeLoop`).
- `actuators/` — dcmotor, hbridge, servo, stepper, bldc, foc, linear, solenoid, pumps, gearing, pneumatics, sizing.
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
- Actuators ✓ 11/11
- Mobility:
  - [x] Differential drive
  - [x] Mecanum wheels
  - [x] Omni & swerve
  - [x] Ackermann steering
  - [x] Tracks & terrain
  - [x] Legged walking
  - [x] Balancing robots
  - [x] Drones & flight
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
