# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** → `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`). Id = entry id minus category, `/` → `-`.
- Numbers only from tested pure fns in `core/` (+ test). Circuits: `Element[]` → `core/nodal.ts` (`solveNodal`, `relaxSweep`, `theveninAt`); diodes via `diodeNode`/`ledStringAmps`. Formatters in `core/units.ts`; control helpers (`e12`, `resistorSlider`, `bitChoice`) in `lessons/types.ts`.
- Reuse `archive/lesson-drafts/`. Shared visuals in `lessons/fx/` (import `'../fx'`); grep before writing a helper.
- Framing: legend top ~30 % (right), chips bottom ~25 %, scene in the middle band, wide over tall.
- Visuals: `potentialColor` for levels; 3D text = `label()`/`partLetter` (stroke font, Q̄ = `'Q\u0304'`); 7-seg = `segmentDisplay`/`pulseLabel`; charges on `lane()`, speed ∝ current; `ease`/`glide` toward targets, `presence` to morph. Per-rebuild materials: `glowMat`/`new` (`emptyGroup` keeps cached `mat()`s).
- Time-lapse: step tested fns, reset on control change, show sim time, ≤ 4 readouts, state the slow-down factor. Fields: retrace only on input change, log-scale decades, forces in screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; params/frames: `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}' frames=N`.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` (model in brackets):
- `util` — easing (`ease`, `glide`), `lerp`, `path`, `emptyGroup`, `presence`, `halton`.
- `colors` — palette, `glowMat`, `potentialColor`. `shapes` — `arrow`, `plusGeometry`, `glowBox`. `text` — `label` [`core/strokeFont`].
- `cells` — `cellCutaway` (electrodes, separator, shuttling ions), `cell18650`, `nickelStrip` (weld sparks), `cellPackModel` (SxP zig-zag pack) [`physics/batteries`, `physics/packs`].
- `heat`, `flows`, `crystal`, `dies` [`semiconductors`, `memory`], `fields` [`core/fields`], `plots`, `story` (stepped lessons).
- `circuit` — cells, sources, `wire`/`lane`, R/D/LED, switches, `icPackage`, ground, op-amp symbol; layout consts.
- `parts` — real packages (TO-92/220, DIP-8, SOT-223, HC-49, fuse), `tp4056Module` [`physics/charging`], `dcdcModule` (LM2596/MT3608/XL6009) [`physics/converters`], `partLetter`. `electromech` — relay/SSR, switches, pot.
- `displays` — `segmentDisplay`, `pulseLabel`, meter/probe, `scope`, `ivScreen`, `phasor`, `clockFace`.
- `logic` — `gateSymbol`, `signalWire`/`litWire`, `inBall`, `ledOut`, `bitRow`, `gateNet` (`Net` schematic), `flipFlopBlock`, `LOGIC_WIRES` [`core/logic`, `core/numbers`].
- `diagrams` — `timingDiagram` (logic analyser), `stateDiagram` [`core/fsm`].
- Digital models: `core/logic` (gates, adders, `Net` eval/step/settle, latches, shift/counter), `core/numbers`, `core/fsm`, `core/fpga`, `physics/timing`, `physics/levels`.

## Pacing

- Serial: one agent at a time; next starts only after the last finishes.
- Gate before each spawn: memory pressure = 1, free disk > 20 GB, loadavg(1m) < 15 for one agent (< 10 for two). Else wait for the hourly check.
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
- Power:
  - [x] Battery chemistry
  - [x] 18650 packs
  - [x] Charging
  - [x] Buck & boost
  - [ ] Power budget
  - [ ] Wiring & gauge
  - [ ] Noise & decoupling
  - [ ] Brownouts
- Signals:
  - [ ] Filters
  - [ ] Fourier intuition
  - [ ] Oscilloscope
  - [ ] Logic analyzer
  - [ ] Transmission lines
  - [ ] Radio basics
  - [ ] Grounding & shielding
  - [ ] PCB design

### Later waves (file order within each)
- Wave 4: Microcontrollers, Sensors, Software
- Wave 5: Actuators, Mobility, Control, Kinematics, Perception, Navigation, AI
- Wave 6: Mechanics, Waves, Math, Materials, Printing
- Wave 7: Practice (projects, challenges, debugging, workshop)
