# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** → `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`). Id = entry id minus category, `/` → `-`.
- Numbers only from tested pure fns in `core/` (+ test); `core/physics` is one flat namespace (unique names); inside it import files, not folder `index`es (cycles). Circuits: `Element[]` → `core/nodal.ts` (`solveNodal`, `relaxSweep`, `theveninAt`), diodes via `diodeNode`/`ledStringAmps`. Formatters: `core/units.ts` (`secs`, `secsText`, `msText`, `mmText`/`mmTenths`, `cmText`, `degText`, `radText`, `fixedText`, `kpText`/`kiText`/`kdText`, `pct`, `bytesText`, `signed`, `signText`, `velocityText`, …), `core/numbers.ts`. Controls: `lessons/types.ts` (`n`, `pick`, `opts`, `e12`, `angleSlider`, `resistorSlider`, `bitChoice`).
- Reuse `archive/lesson-drafts/`. Shared visuals in `lessons/fx/` (map below); grep before writing a helper.
- Framing: legend top ~30 % (right), chips bottom ~25 %, scene in the middle band, wide over tall.
- Visuals: `potentialColor` for levels; 3D text = `label()`/`partLetter` (stroke font, Q̄ = `'Q\u0304'`); 7-seg = `segmentDisplay`/`pulseLabel`; charges on `lane()`, speed ∝ current; `ease`/`glide` toward targets, `presence` to morph. Per-rebuild materials: `glowMat`/`new` (`emptyGroup` keeps cached `mat()`s). Heavy time-lapse solves: `memoBy(key, compute)`.
- Robot frames: body X forward, Y left, Z up; pitch > 0 = nose up; heading clockwise from north (`tiltAccel`, `bodyAccel`, `toBody`).
- Time-lapse: step tested fns, reset on control change, show sim time, ≤ 4 readouts, state the slow-down factor. Fields: retrace only on input change, log-scale decades, forces in screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; params/frames: `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}' frames=N`.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` (import `'../fx'`; model in brackets):
- `util` — `ease`/`glide`/`glideAngle`, `lerp`, `frac`, `smoothstep`, `sineHash`, `add3`, `path`, `emptyGroup`, `presence`, `halton`, `memoBy`, `peakToPeak`.
- `colors` — palette (`HEAT`, `INK`, …), `lit` (THREE.Color), `glowMat`, `setGlow`, `potentialColor`, `toneColor` (readout tone → colour).
- `shapes` — `arrow`, `stretchArrow` (any length a→b), `plusGeometry`, `glowBox`, `flatBox` (shadowless), `trayMat`, `shellMat` (see-through housing), `sectorGeometry`.
- `text` — `label` (U+0304 overbar, U+0307 dot: θ̇, U+0308: q̈), `addLabel` (shadowless, at a point), `liveLabel` (changing text), `textLines` (3 lines + status) [`core/strokeFont`].
- `layout` — `wire`, `cableRun`, `LANE`/`lane`, `R_SCALE`/`RS`/`CELL_H`, `cellFraction`, `dropAlong`, `lieFlat`/`standUp`, `UNIT_ROD`/`shadowlessRod`/`stretchRod`, `addRod`, `rodBetween`.
- `circuit` — cell, bulb, R/D/LED, thermistor, ceramic, `chargeTank`, `terminal`/`junction`, switches, `icPackage`, `glowHalo`, `motorCan`, `resistorLoop`.
- `symbols` — ground, current/AC source, diode, op-amp.
- `parts` — real packages (TO-92/220, DIP-8, SOT-223, HC-49, fuse), `partLetter`, `litEpoxy`.
- `modules` — `tp4056Module`, `dcdcModule`, `sg90Servo`, `stepDriver` (A4988/TMC2209, `pin(name, side)`, `trim`), `esp32Board` (face-on, `pin(i, top)`), `esp32Cam` (OV2640 lens, `lens()`, `iris`), `i2cBreakout` (sensor board, `pin(name)`), `pca9685Board` (16-ch servo driver flat, `ch(i)`/`vplus`/`i2c`, `lit`) [`physics/power`].
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
- `feedback` — `controlLoop` (r → Σ → controller → plant → y, sensor feedback, optional disturbance/noise; `set(dt, levels, texts, titles?)`; every Control lesson), `sumBars`/`termBars` (signed terms + sum, `satText`), `PID_COLORS`, `MEAS_COLOR`, `sPlane` (poles, root-locus dots).
- `plants` — `pidArm` (gearmotor arm: spring, pot, setpoint ghost, error arc, `peg`), `speedWheel` (TT wheel on a tilting floor + rpm gauge), `positionCar` (side-view TT car to a flag, springy camera mast).
- `mcu` — `codeBlock` (Arduino/ESP-IDF lines; `rosTint` + `ROS_CODE_LEGEND` for rclpy/rclcpp/CLI), `CODE_LEGEND`, `PIN_COLOR`, `IDLE`, `fetSymbol` (in-pin FET), `ledLoad`.
- `frames` — `frameTriad` (RGB axes; `letters`, `planar`, `face()` turns text to the viewer), `faceFront`, `zUp` (z-up metres group), `setTf` (4×4 onto an object), `matrixGrid` (bracketed number matrix), `urdfModel` (links from a parsed URDF, `pose(q)`) [`physics/software/urdf`, `physics/kinematics`].
- `arms` — `serialArm` (any `SerialArm`; `set(q)` → frames, `glow(i, k)`, opt. triads/gripper/pedestal), `ghostRig` (see-through copy), `JOINT_COLORS`, `SERVO_JOINT_NAMES`, `SERVO_ARM_LOOK` + `PLINTH`, `armPlate`, `dotPen` (dot lines/arcs, hand trails), `servoArmBuild` (hobby build: servos, base, `fit`/`heat`/`ports`) [`physics/kinematics`]; clouds = `rooms.pointCloud`.
- `wheeled` — `diffBot` (TT two-wheeler, `set(pose, dL, dR)`, `slip`, `ghost`), `rcCar` (1/10 Ackermann, `set(pose, steer, travel)`, `arms`, `scrub`), `balanceBot` (side-view self-balancer, `set(tilt, roll)`), `balanceFloor` (scrolling side-view floor for it), `onBalancer` (point on its body), `balanceCues` (shove/accel arrows, target flag), `slipPatch`/`lightPatches` [`physics/mobility`].
- `holonomic` — `mecanumBot`/`mecanumWheel`, `omniBot` (kiwi/X), `swerveBot` (FRC; `glow`); all `set(pose, …)`.
- `tracked` — `trackedBot` (sprockets, moving links; `wheels` = 4WD twin; `body`, `scuff`, `spin`).
- `drive` — `placeAt` (object ← Pose), `inField`, stick tours (`TOUR_MODES`, `TourSeg`, `tourAt`, `tourLength`).
- `rigs` — side-view time-lapse: `SIDE_VIEW`, `SIDE_SCOPE`, `statusHeader`, `tiltRig`, `scopeLabels`, `sideScope`, `traceRun` (fixed-step run → scope trace), `lapseClock` (looping time-lapse clock).
- `aerial` — `quadcopter` (`pose`, `set(spin, share, clipped)`), `spinArc`, `SPIN_COLORS`.
- `marine` — `rovModel` (`trim`, `set(spin, share)`, `wake`), `waterTank`.
- `legged` — `servoWalker` (hexapod/quadruped, `set(pose, angles, down)`), `servoBiped` (`set(lean, tip)`).
- `net` — `phoneModel`, `routerModel`, `robotCar` (ESP32 on the flank), `stickPhone` (thumbstick, `stick(x, y)`), `ripples`, `arcAt`, `packetPool` (header + payload blocks in flight), `topicPipe` (named ROS topic, `at(u)`) [`physics/mcu/wireless`, `physics/software`].
- `logic` — `gateSymbol`, `signalWire`/`litWire`, `inBall`, `ledOut`, `bitRow`, `gateNet`, `flipFlopBlock`, `LOGIC_WIRES` [`core/logic`].
- `flows` — `Flow`, electron gas, ion lattice, `plusFlow`, `loopBeads`.
- `pixels` — `showImg` (an `Img` onto a `sensing.pixelGrid`, `PixelView` per pixel), `zoomInset` (n × n magnifier: RGB sub-pixel stripes, value labels, frame + leader lines), `pixelRelief` (brightness as box heights), `histChart` (bars, `marker`, `curve` CDF dots, `axis`), `hueWheel` (hue angle, saturation radius), `rodPool` (instanced rods, `heads` = arrow field), `ringMarks` (instanced keypoint rings) [`physics/perception`].
- `heat`, `crystal`, `dies`, `fields`, `plots`, `story` (stepped lessons).

`core/physics/` (flat files: dc, ac, circuits, semiconductors, electromechanical (relays, switches, pots), … timing, levels) + subfolders:
- `power/` — batteries, packs, charging, converters, budget, wiring, noise, brownout.
- `signals/` — filters, fourier, scope, buses (I²C/SPI/register frames), transmission, radio, interference, pcb.
- `mcu/` (ESP32) — gpio, pwm, adc, dac, timers, uart, i2c, spi, can, wireless, sleep, memory, rtos, boot, firmware (super-loop vs tasks, driver layers, fixed-rate loop).
- `software/` — messaging (QoS, actions), urdf (`tf3`, `parseUrdf`, `ROVER`), frames (`odomPose`, `tfChain`), costmap (`inflate`, A* `planGrid`), btree (`btTick`, `NAV_TREE`), fetchbot, microros, telemetry, simulation (`physStep`, `twinRun`), remote (`stickToWheels`), safety (`wdtRun`, `estopRun`).
- `mobility/` — diffdrive (`diffStep`, `squareRun`, `slipRun`), mecanum (`mecInverse`/`mecForward`, `twistStep`, `fitTwist`, `mecRun`), omni, swerve, ackermann (`steerAngles`, `bicycleStep`, `pursuitRun`, `parkPlan`), tracks (`TERRAINS`, `skidRun`, Bekker sinkage, `softPull`), legged (`GAITS`, `gaitFeet`, `legIK`, `zmpRun`), balance (`cartStep`, `balanceLoop`; PID from `control/pid`), quadcopter (`mix`, `quadBodyStep`, `attitudeLoop`), underwater (`rovTrim`, `buoyRun`, `allocate`, `rovRun`).
- `control/` — linalg (`Cx`, `polyRoots`, `Mat` ops, `matInv`, `expm`, `charPoly`/`eigenvalues`, `cholSolve`, `matVec`, `symEig` Jacobi), loop (TT car `openLoopRun` vs `closedLoopRun`, `trialConditions`, `ROLL_FLOORS`, `pDeadband`), bangbang (`bangBang`, `thermostatRun`/`cycleStats`, `followRun`), pid (`pidStep`, `pidTick` anti-windup/D-on-meas/D filter, `stepMetrics`, `swing`, `ultimateGain`, `zieglerNichols`), arm (`ARM`, `ARM_FROM`, `armRun` with `from`/`lag`/`ff`, `loadDuty`), speed (`wheelStep`, `wheelCpr`, `wheelFf`/`ffVolts`, `wheelSpeedRun`, `stepSp`/`rampSp`, `speedStats`), position (`trapezoidMove`/`sCurveMove`/`stepMove`, `moveAt`, `positionRun` cascade + mast, `moveStats`), linefollow (`barAt`/`errorSweep`, `Tape`/`tapeDist`, `steerRun`, `junctionRun`), stability (`armPoles` Padé delay, `dominant`, `secondOrder`, `placePd`, `loopAt`, `margins`/`marginsOf`), lqr (`c2d`, `dlqr`, `balancerModel`, `BALANCER_TOL`, `brysonQ`, `balancerLqr`, `stateRun`), mpc (`boxQp`, `mpcDesign`, `predict`, `mpcSolve`, `mpcRun`), loopfilter (`MeasFilter`, `filterAt`, `filterDelay`, `noiseGain`, `filteredMargins`, `kalmanSpeed`).
- `kinematics/` — transforms (`rot2`/`rotate2`, planar `tf2`/`mulTf2`/`applyTf2`/`invertTf2`, `trans4`, `rotAbout4`, `chain4`, `originOf`/`axisOf`, `rpyOf`, `Quat`: `quatAxis`/`quatMul`/`quatTf`/`quatOf`/`slerp`/`quatAngle`; 4×4 base `Mat4`/`mul4`/`apply4`/`invert4`/`tf3`/`rotAxis4` in software/urdf), frametree (`FrameTree`, `rootPath`, `frameWorld`, `framePath`, `frameLookup`, `DESK`/`deskTree`), chain (standard DH `DhRow`/`dhTf`/`dhJointTf`, `SerialArm`, `armFk` → every joint frame, `toolOf`, `planarArm`/`planarFk`/`twoLinkTip`, `SERVO_ARM` 4-DOF), jacobian (`armJacobian` 3×n, `planarJacobian` 2×n, `handVelocity`, `jointTorques` τ = JᵀF, `twoLinkDet`, `manipulability`, `isSingular`, `resolvedRateRun`), ik (`twoLinkIk` both elbows + reach clamp, `servoArmIk` 4 branches + `inLimits`, `poseGroups`, `ikIterate` transpose/DLS), workspace (`jointGrid`, `reachCloud` + `keep` cut-outs, `twoLinkRadii`, `cellMeasure`, `planarPoseAt`/`headingReach`/`dexterity`/`dexterityGrid`, `dexterousBand`), trajectory (`cubicCoeffs`/`quinticCoeffs`/`polyAt`, `lerpJoints`, `jointLine` vs `cartesianLine`, `unwrapPath`, `lineDeviation`, `peakRates`, `viaPath`/`viaAt` linear/stop/spline, `chordTimes`, `timeScale` (reuses control/position), `jointScale`, `syncScale`), gripper (`jawHalfGap`/`jawTouchDeg`/`jawForceN` rack/linkage/angular, `servoSqueezeNm`, `requiredSqueezeN`, `jawHoldN`, `suctionForceN`, `VAC_SURFACES`, `suctionRun`, tendon `gripWrap`/`wrapHoldN`), armbuild (`ARM_SERVOS`, `driveAt`, `ARM_BUILD`/`armMasses`, `holdTorques` τ = Jᵀ·m·g, `armBudget` rail sag + brownout, `ARM_CAL`/`pulseUs`/`hornShift`/`reversed`, `pcaTicks`/`actualJoints`, `sagJoints`, `handGap`), dynamics (`servoTwoLink`/`lumpLink`; Lagrange `massMatrix`/`coriolis`/`gravity`, `inverseDynamics` term split, `forwardDynamics` RK4, `armEnergy`/`freeSwing`, `couplingTorque`, `reflectedInertia`, `restMove`, `driveClip` T–ω, `trackRun` PD + feed-forward, `moveDemand`/`fastestMove`/`maxPayload`).
- `actuators/` — dcmotor (`TT_GEAR`), hbridge, servo, stepper, bldc, foc, linear, solenoid, pumps, gearing, pneumatics, sizing.
- `sensors/` — `ultrasonic`, `infrared` (TCRT `linePosition`, `readBar(pose, offset)`, `darkness`), `tof`, `lidar`, `encoder` (`odoStep`), `imu`, `magnetometer` (`toBody`), `gps`, `camera`, `temperature`, `current` (`socRun`), `force`, `microphone` (TDOA `locate`), `fusion` (`kfPredict`/`kfUpdate`, `fuseRun`).
- `perception/` — image (`Img` w × h × 1|3 floats 0…255, `makeImg`/`imgAt`/`pixelOf`/`setPixel`/`mapImg`, `tabletopImg` deterministic test scene + `SCENE_SPOTS`, `grayImg`/`lumaOf`/`channelImg`, `rgbToHsv`/`hsvToRgb`/`hueGap`/`hsvMask`, `imgHistogram` (reuses sensors/camera `histogram`), `imgStats`, `cumulative`, `otsuLevel`, `thresholdImg`, `maskStats` (count, centroid), `maskIoU`, `contrastImg`, `equalizeImg`, `KERNELS`/`convolveImg`, `resizeImg` nearest/bilinear, `noisyImg` (`gaussAt`), `bitDepthImg` (mcu/adc `quantize`), `imageBytes`), features (Sobel `gradientOf`, `dirBin`, NMS `thinEdges`, `hysteresis` (+ BFS depth), `canny`, `houghLines`/`lineInImg`, structure tensor `cornerField` Harris/Shi-Tomasi, `eigen2`, `harrisBoundary`, `pickCorners`, `patchDescriptor`/`descDistance`, `matchDescriptors` ratio + mutual, `warpImg`/`warpPoint`), tracking (`erodeMask`/`dilateMask`/`openMask`/`closeMask`/`cleanMask`, `labelBlobs` (area, centroid, box), `largestBlob`, `findBlob` (HSV mask → clean → biggest), `ballFrame` (red ball on a cached backdrop + table noise), `PAN_CAM`/`columnOf`, `panTrackRun` (camera frames → centroid → PD → SG90 pan, one-frame delay, search when lost), `panStats`).
- `common.ts` — `LIGHT_C`, `SOUND_C`, `G`/`weightN`, `DEG`/`toDeg`, `stdDev`, `frac`, `clamp`/`clamp01`, `fixedStepAt`, `wrapPi`/`wrap2pi`, `hash01`, `gaussAt` (repeatable noise).
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
- Mobility ✓ 9/9
- Control ✓ 10/10
- Kinematics ✓ 9/9
- Perception:
  - [x] Image basics
  - [x] Edges & features
  - [x] Colour tracking
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
