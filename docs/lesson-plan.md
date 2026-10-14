# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** → `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`). Id = entry id minus category, `/` → `-` (`curriculum.test.ts`).
- Numbers come from tested pure fns: `core/physics/<domain>.ts` + test; circuits as `Element[]` → `core/nodal.ts` (`solveNodal`, `relaxSweep`, `theveninAt`); diodes/LEDs via `diodeNode`/`ledStringAmps`; fields via `core/fields.ts`. Formatters (`volts`, `si`, `secs`, `pct`, `tiny`, `fitDigits`…) in `core/units.ts`; `e12`, `resistorSlider` in `lessons/types.ts`.
- Reuse `archive/lesson-drafts/`. Shared visuals in `lessons/fx/` (import `'../fx'`); grep before writing a helper.
- Framing: legend top ~30 % (right), chips bottom ~25 %; scene in the middle band, wide over tall.
- Visuals: potential = `potentialColor`; 3D numbers = `segmentDisplay`/`pulseLabel`; charges on `lane()` (`LANE`), speed ∝ that wire's current; `ease(dt)` toward targets, `presence` to morph. `emptyGroup` keeps cached `mat()`s, so per-rebuild materials use `glowMat`/`new`.
- Time-lapse: step tested fns, reset on control change, show sim time, ≤ 4 readouts; slow real frequencies by a stated factor. Fields: retrace only on input change, log-scale decades, forces in screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; params/frames: `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}' frames=N`.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` (models in `core/physics/` in brackets):
- `util` — `clamp01`, `lerp`, `ease`, `path`, `emptyGroup`, `presence`, `halton`.
- `colors` — palette (`LABEL`, `LED_RED`…), `glowMat`, `potentialColor`. `shapes` — `arrow`, `plusGeometry`. `heat` — `heatGlow`, `thermometer`, `heatWaves`, `smoke`.
- `flows` — `Flow`, `plusFlow`, glass wire, `ionLattice`, `electronGas`.
- `circuit` — cells, sources, `wire`, `lane`, resistors, diodes, `ledLamp`, `bulb`, switches, `motorCan`, `icPackage`, `chargeTank`, `groundSymbol`/`groundAt`, `opAmpSymbol`; layout `LANE`, `R_SCALE`, `RS`, `CELL_H`, `cellFraction`.
- `parts` — real packages: `transistorPart` (TO-92), `fetPart` (TO-92/TO-220), `dip8OpAmp`, `sot223Regulator`, `hc49Crystal`, `glassFuse`; `litEpoxy`, `partLetter` (static text).
- `electromech` — cut-open `relayPart`/`ssrPart`, `tactSwitch`, `toggleSwitch`, `rotaryPot` [`electromechanical`].
- `dies` — `bjtDie`, `mosfetDie` cross-sections, `oxideGlass`/`gateMetal` for extra gate stacks [`semiconductors`, `memory`].
- `crystal` — `siliconCrystal` lattice, `DONOR`/`ACCEPTOR`; `junction` mode for PN.
- `displays` — `segmentDisplay`, `pulseLabel`, `multimeter`/`probe`, `scope`, `ivScreen`/`ticks`, `phasor`, `clockFace`.
- `plots` — `formulaTriangle`, `voltScale`, `areaPlot`, `voltStack`, `inOutBars`.
- `fields` — `fieldLines`, `arrowGrid`, `chargeBall`, `compass`, coils (`coil`, `inductorCoil`, `coilLines`), `barMagnet`.
- `story` — `storySlider`, `storyClock` for stepped lessons.
- `logic` — `gateSymbol` (AND…XNOR, NOT), `litWire` glowing path, `bitRow` LED bits with place values [`core/logic.ts`: gates, truth tables, `cmosNand`, adders, `rippleSteps`; `core/numbers.ts`: binary/hex, two's complement, `addWrap`].

## Pacing

- Serial: one agent at a time; next starts only after the last finishes.
- Gate before each spawn: memory pressure = 1, free disk > 20 GB, loadavg(1m) < 15 for one agent (< 10 for two). Else wait for the hourly check.
- After each section (category) is done: one cleanup agent before the next topic — split/dedupe shared code (`lessons/fx/`, `core/`), drop dead code, compact this file and `DESIGN.md`. No behaviour change.
- Hourly check: read git log + this file, check load; speed up (2 agents in parallel, on different categories) only if the Mac is idle and the last runs were clean; pause on red tests or overload.
- Builds/tests run with `nice -n 10`.
- Install on the iPhone only once the whole queue is done (not per topic), from the clean worktree `/tmp/robo-sims-install` (`git checkout --detach <hash>`, then `nice -n 10 make ios-build ios-run`), so agents' uncommitted edits never get bundled. Its `node_modules` is an APFS clone (`/bin/cp -cR`); a symlink breaks Metro.

## Queue

Order follows the drafts backlog, then the home sections. Tick when committed.

### Wave 1 — Electricity
- [x] Current
- [x] Voltage
- [x] Resistance
- [x] Ohm's law
- [x] Power & energy
- [x] Series & parallel
- [x] Voltage divider
- [x] Kirchhoff's laws
- [x] Thevenin & Norton
- [x] AC vs DC
- [x] Electric fields
- [x] Magnetism

### Wave 2 — Components & semiconductors (drafted first)
- [x] Capacitor
- [x] Diode
- [x] LED
- [x] Silicon & doping
- [x] PN junction
- [x] MOSFET physics
- [x] Chip making
- [x] Resistor
- [x] Inductor
- [x] Transistor (BJT)
- [x] MOSFET
- [x] Relay
- [x] Switches & buttons
- [x] Potentiometer
- [x] Fuses & protection
- [x] Crystal oscillator
- [x] Op-amp
- [x] Voltage regulators
- [x] Logic gates
- [x] Memory cell

### Wave 3 — Digital, Power, Signals
- Digital:
  - [x] Binary & hex
  - [ ] Combinational logic
  - [ ] Flip-flops & latches
  - [ ] Counters & shift registers
  - [ ] State machines
  - [ ] Timing
  - [ ] Level shifting
  - [ ] FPGA basics
- Power:
  - [ ] Battery chemistry
  - [ ] 18650 packs
  - [ ] Charging
  - [ ] Buck & boost
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
