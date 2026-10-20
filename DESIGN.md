# Design

## Problem

Learning electronics and robotics hands-on means owning parts, and it's easy to wire something wrong without understanding why. Goal: a pocket workbench with real parts in 3D and circuits that work, explained by the same Ohm's-law formulas as [`robotic-references/hello-electronics`](https://github.com/solomonxie/robotic-references/tree/master/hello-electronics). It's a teaching tool, not SPICE.

## Platform

- iPhone only, portrait. React Native 0.87 (new architecture) + TypeScript.
- No Expo and no dev server. Release builds embed `main.jsbundle`.
- 3D: `react-native-webgpu` (Dawn → Metal) + `three/webgpu` (`WebGPURenderer`). Metro maps `three` to the WebGPU build so there's one Three instance.
- The previous web version (Vite + R3F) is in `archive/web/`.

## Layout

| Path | Role |
|---|---|
| `app/src/core/` | Pure TS, no React/Three, unit-tested: breadboard + union-find nets, catalog, LED loop, nodal solver, field tracing, units, stroke font; digital: logic nets, numbers, FSMs, FPGA fabric. `physics/`: lesson formulas by domain (dc, ac, circuits, …, timing, levels), shared constants in `common`; one subfolder per domain (`power/`, `mcu/` (ESP32), `sensors/` … `materials/`, `printing/`, `projects/`, `challenges/`; map in `docs/lesson-plan.md`). |
| `app/src/models/` | Procedural Three.js model per part `type`; the look comes from specs (e.g. resistor bands from `ohms`). |
| `app/src/scene/` | `Viewport` (WebGPU canvas, touch orbit/pinch/pan, tap-to-pick), stage lighting, demo bench. |
| `app/src/lessons/` | Learn tab: one `Lesson` = text + formula + controls + `build()` → animated 3D stage. `<category>/<topic>.ts`; shared visuals in `fx/` (module map in `docs/lesson-plan.md`). |
| `app/src/screens/` | Bench, Learn, lesson, Parts list, single-part viewer. |

## 3D models

- Units: 1 = one hole pitch (2.54 mm). Board top at y = 0, leads go into holes at y = −1.5.
- Sizes follow real datasheets: 5 mm LED, ¼ W resistor, 18650 cell (18 × 65 mm), HC-SR04 (45 × 20 mm), ESP32 DevKit v1 30-pin, L298N (43 mm square), TT motor, 65 mm wheel, 60 mm mecanum wheel (9 rollers at 45°).
- No imported assets. A new part is a catalog entry, plus a builder only if it's a new kind of shape.
- No environment map, so metals stay at low metalness (otherwise they render black).
- Breadboard holes are one `InstancedMesh`.
- Only one renderer is alive at a time. Screens unmount theirs, and the dispose path works around react-native-webgpu#445.

## Learn

- One topic at a time, polished before the next. Shipped: Electricity (12 topics, 37 lessons), Components (14 topics, 47 lessons: Resistor → Voltage regulators), Semiconductors (6 topics, 18 lessons: Silicon & doping → Memory cell), Digital (8 topics, 24 lessons: Binary & hex → FPGA basics), Power (8 topics, 23 lessons: Battery chemistry → Brownouts), Signals (8 topics, 25 lessons: Filters → PCB design), Microcontrollers (14 topics, 44 lessons: GPIO → Bootloader & flashing), Sensors (14 topics, 38 lessons: Ultrasonic → Sensor fusion), Software (10 topics, 24 lessons: Firmware structure → Safety & failsafes), Actuators (11 topics, 32 lessons: DC motor → Motor selection), Mobility (9 topics, 23 lessons: Differential drive → Underwater & swimming), Control (10 topics, 27 lessons: Open vs closed loop → Filters in the loop), Kinematics (9 topics, 23 lessons: Coordinate frames → Dynamics), Perception (9 topics, 22 lessons: Image basics → Occupancy grids), Navigation (9 topics, 23 lessons: Odometry → Swarm & multi-robot), AI (7 topics, 16 lessons: Neural nets 101 → Anomaly detection), Mechanics (10 topics, 27 lessons: Newton’s laws → Vibration), Waves (7 topics, 16 lessons: Sound & ultrasound → Gravity & inertia), Maths (9 topics, 24 lessons: Vectors → Signals), Materials (8 topics, 19 lessons: Stress & strain → Thermal design), 3D printing (17 topics, 68 lessons: How FDM works → Print a robot), Robot projects (12 topics, 30 lessons: Robo-car → Desk lamp tracker), Circuit challenges (5 topics, 11 lessons: LED puzzles → Logic puzzles). Drafts for the rest in `archive/lesson-drafts/` (backlog order in its README).
- Visuals are exaggerated; every number shown comes from `core/physics/` (tested).
- `make preview LESSON=<id>`: headless-Chrome render (WebGPU on Metal, same scene code, overlays mocked) for framing without a device. Not a simulator; the iPhone is the real check.
- 3D text: vector stroke font (`core/strokeFont.ts`) built as one merged mesh per label (`fx/text.ts`); no font files or canvas, so device and preview match.
- Rendering: Neutral tone mapping; the clear color is pre-compensated so the canvas matches the RN background exactly.

## Simulation

- Now: one LED loop (supply → R → LED). `I = (V − Vf) / R`, gives a status and reason, and drives the LED glow plus a point light.
- `core/nodal.ts`: linear nodal solver (conductance stamping, ideal V sources as extra MNA rows, Gaussian elimination; Gauss–Seidel relaxation for lessons).
- Next: run it over union-find nets, diode clamp by re-solve. H-bridge truth table, PWM averages, and sensor formulas as small modules.
- Out of scope: firmware emulation and live links to real hardware.

## Roadmap

- **M0** (done): app shell, 16 procedural models, demo bench, resistor swap → live LED current, Learn tab with its first lesson (Current).
- **M1**: place parts from the Parts list onto holes (snap pins), and remove them.
- **M2**: wire tool hole-to-hole, net resolution, save/load designs.
- **M3**: general solver, current-flow particles, virtual multimeter.
- **M4**: assemble a robo-car (chassis, L298N + TT motors, ESP32 GPIO inspector).
