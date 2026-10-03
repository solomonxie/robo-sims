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
| `app/src/core/` | Pure TS, no React/Three: breadboard holes + union-find nets, catalog, formulas, LED-loop solver. Unit-tested. |
| `app/src/models/` | Procedural Three.js model per part `type`; the look comes from specs (e.g. resistor bands from `ohms`). |
| `app/src/scene/` | `Viewport` (WebGPU canvas, touch orbit/pinch/pan, tap-to-pick), stage lighting, demo bench. |
| `app/src/lessons/` | Learn tab: one `Lesson` = text + formula + controls + a `build()` returning an animated 3D stage. Shared effects in `fx.ts` (charge flows, particle swarms, cells, arrows). |
| `app/src/screens/` | Bench, Learn, lesson, Parts list, single-part viewer. |

## 3D models

- Units: 1 = one hole pitch (2.54 mm). Board top at y = 0, leads go into holes at y = −1.5.
- Sizes follow real datasheets: 5 mm LED, ¼ W resistor, 18650 cell (18 × 65 mm), HC-SR04 (45 × 20 mm), ESP32 DevKit v1 30-pin, L298N (43 mm square), TT motor, 65 mm wheel, 60 mm mecanum wheel (9 rollers at 45°).
- No imported assets. A new part is a catalog entry, plus a builder only if it's a new kind of shape.
- No environment map, so metals stay at low metalness (otherwise they render black).
- Breadboard holes are one `InstancedMesh`.
- Only one renderer is alive at a time. Screens unmount theirs, and the dispose path works around react-native-webgpu#445.

## Learn

- One lesson at a time, polished before the next. Shipped: **Current**. The rest are drafts in `archive/lesson-drafts/` (backlog order in its README).
- Visuals are exaggerated; every number shown comes from `core/physics.ts` (tested).
- `make preview LESSON=current` renders the lesson in headless Chrome (WebGPU on Metal, same scene code) with the screen's overlays mocked, to iterate on framing and look without a device. It's not a simulator; the iPhone is still the real check.
- Rendering: Neutral tone mapping; the clear color is pre-compensated so the canvas matches the RN background exactly.

## Simulation

- Now: one LED loop (supply → R → LED). `I = (V − Vf) / R`, gives a status and reason, and drives the LED glow plus a point light.
- Next: nodal analysis over union-find nets (conductance stamping, ideal sources by substitution, diode clamp by re-solve). H-bridge truth table, PWM averages, and sensor formulas as small modules.
- Out of scope: firmware emulation and live links to real hardware.

## Roadmap

- **M0** (done): app shell, 16 procedural models, demo bench, resistor swap → live LED current, Learn tab with its first lesson (Current).
- **M1**: place parts from the Parts list onto holes (snap pins), and remove them.
- **M2**: wire tool hole-to-hole, net resolution, save/load designs.
- **M3**: general solver, current-flow particles, virtual multimeter.
- **M4**: assemble a robo-car (chassis, L298N + TT motors, ESP32 GPIO inspector).
