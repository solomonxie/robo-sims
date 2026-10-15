# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** → `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`). Id = entry id minus category, `/` → `-`.
- Numbers only from tested pure fns in `core/` (+ test). Circuits: `Element[]` → `core/nodal.ts` (`solveNodal`, `relaxSweep`, `theveninAt`); diodes via `diodeNode`/`ledStringAmps`. Formatters in `core/units.ts` (`hoursText`, `millivolts`, …); control helpers (`e12`, `resistorSlider`, `bitChoice`) in `lessons/types.ts`.
- Reuse `archive/lesson-drafts/`. Shared visuals in `lessons/fx/` (import `'../fx'`); grep before writing a helper.
- Framing: legend top ~30 % (right), chips bottom ~25 %, scene in the middle band, wide over tall.
- Visuals: `potentialColor` for levels; 3D text = `label()`/`partLetter` (stroke font, Q̄ = `'Q\u0304'`); 7-seg = `segmentDisplay`/`pulseLabel`; charges on `lane()`, speed ∝ current; `ease`/`glide` toward targets, `presence` to morph. Per-rebuild materials: `glowMat`/`new` (`emptyGroup` keeps cached `mat()`s). Heavy time-lapse solves: `memoBy(key, compute)`.
- Time-lapse: step tested fns, reset on control change, show sim time, ≤ 4 readouts, state the slow-down factor. Fields: retrace only on input change, log-scale decades, forces in screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; params/frames: `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}' frames=N`.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` (model in brackets):
- `util` — `ease`/`glide`, `lerp`, `frac`, `path`, `emptyGroup`, `presence`, `halton`, `memoBy`.
- `colors` — palette (`HEAT`, …), `glowMat`, `potentialColor`. `shapes` — `arrow`, `plusGeometry`, `glowBox`. `text` — `label`, `liveLabel` (changing text) [`core/strokeFont`].
- `layout` — `wire`, `cableRun`, `LANE`/`lane`, `R_SCALE`/`RS`/`CELL_H`, `cellFraction`, `dropAlong`, `lieFlat`/`standUp`.
- `circuit` — cell, bulb, R/D/LED, thermistor, ceramic, `chargeTank`, `terminal`/`junction`, switches, `icPackage`, `glowHalo`, `motorCan`, `resistorLoop`.
- `symbols` — ground, current/AC source, diode, op-amp.
- `parts` — real packages (TO-92/220, DIP-8, SOT-223, HC-49, fuse), `partLetter`, `litEpoxy`.
- `modules` — `tp4056Module`, `dcdcModule` (LM2596/MT3608/XL6009), `sg90Servo` [`physics/power`].
- `boards` — `pcbStack` (explodable layer stack, `via`), `flatTrace`, `flatText` [`physics/pcb`]. `flows` — `loopBeads`.
- `cells` — `cellCutaway`, `cell18650`, `nickelStrip`, `cellPackModel` [`physics/power`].
- `electromech` — relay/SSR, switches, pot. `heat`, `flows`, `crystal`, `dies`, `fields`, `plots`, `story` (stepped lessons).
- `displays` — `segmentDisplay`, `pulseLabel`, meter/probe, `scope`, `benchScope` (DSO: knobs, status, BNC) [`physics/scope`], `ivScreen`, `phasor`, `clockFace`.
- `logic` — `gateSymbol`, `signalWire`/`litWire`, `inBall`, `ledOut`, `bitRow`, `gateNet`, `flipFlopBlock`, `LOGIC_WIRES` [`core/logic`].
- `diagrams` — `timingDiagram`, `stateDiagram` [`core/fsm`], `captureScreen` (analyser rows + decoder strip), `usbAnalyzer` [`physics/buses`].
- `core/physics/` by domain; `power/` = batteries, packs, charging, converters, budget, wiring, noise, brownout.

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

### Wave 3 — Digital, Power, Signals
- Digital ✓ 8/8
- Power ✓ 8/8
- Signals:
  - [x] Filters
  - [x] Fourier intuition
  - [x] Oscilloscope
  - [x] Logic analyzer
  - [x] Transmission lines
  - [x] Radio basics
  - [x] Grounding & shielding
  - [x] PCB design

### Later waves (file order within each)
- Wave 4: Microcontrollers, Sensors, Software
- Wave 5: Actuators, Mobility, Control, Kinematics, Perception, Navigation, AI
- Wave 6: Mechanics, Waves, Math, Materials, Printing
- Wave 7: Practice (projects, challenges, debugging, workshop)
