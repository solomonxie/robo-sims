# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/electricity/current.ts`.

## Unit of work

- One agent = one **topic** (all its entries, usually 3–4 lessons) in `lessons/<category>/<topic>.ts`, one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`).
- Lesson id = entry id without the category, `/` → `-`; `curriculum.test.ts` enforces it.
- Numbers shown come from tested pure fns in `core/` (`core/physics/<domain>.ts` + test; circuits: `Element[]` → `core/nodal.ts` `solveNodal`, `relaxSweep` to animate, `theveninAt`; diodes/LEDs: `DIODES`/`LEDS` + `diodeAmps`/`diodeNode` (`ledStringAmps`: LED + resistor as a load) in `semiconductors`; fields: `core/fields.ts` tracers). Formatters (`volts`, `ohms`, `fitDigits`…) in `core/units.ts`; `e12`, `resistorSlider` in `lessons/types.ts`.
- Reuse `archive/lesson-drafts/` where a draft exists. Shared visuals go in `lessons/fx/` (import `'../fx'`); grep it before writing a helper.
- Framing: legend covers the top ~30 % (right), readout chips the bottom ~25 %; keep the scene in the middle band, wide over tall.
- Visual rules: potential = `potentialColor` (blue 0 V → red); numbers in 3D = `segmentDisplay`/`pulseLabel` (no 3D text); charges ride at `LANE` in front of wires; flow speed ∝ that wire's current; ease toward targets with `ease(dt)`, morph parts with `presence`, not timelines.
- Rebuilt groups: `emptyGroup` keeps cached `mat()` materials, so per-rebuild materials use `glowMat`/`new`.
- Time-lapse sims: step with tested pure fns, reset on control change, show sim time; ≤ 4 short readouts. Slow real frequencies by a fixed factor and say so.
- Vector fields: retrace only when inputs change; log-scale lengths/line counts that span decades; keep forces in the screen plane.
- Preview: `make preview LESSON=<id>` → `/tmp/<id>.png`; extremes `cd app && node tools/preview/shoot.mjs <id> <png> params='{"k":v}'`; `frames=N` (default 90) for timed states.
- Done = `make test typecheck lint` green + preview viewed + one local commit. No device build, no push.

`lessons/fx/` modules:
- `util` — `clamp01`, `lerp`, `ease`, `path`, `emptyGroup`, `presence`, `halton`.
- `colors` — palette (`HIGH_V`, `LOW_V`, `CONVENTIONAL`, `HOLE`, `POWER`, `B_FIELD`, `FORCE`…), `glowMat`, `potentialColor`.
- `shapes` — `arrow`, `plusGeometry`.
- `flows` — `Flow`, `plusFlow` (potential-tinted + charges), glass wire, `ionLattice`, `electronGas`.
- `circuit` — `cell`, `wire`, `bulb`, `arcSpark`, `resistorAlong`/`swapResistor`, `resistorLoop`, `junction`, `terminal`, `dropAlong`, `groundSymbol`, sources, `thermistorAlong`, `ceramicAlong`, `diodeAlong`/`diodeSymbol`, `ledLamp` (real LED, light ∝ √current), `glowHalo`, `knifeSwitch`, `pushButton`, `motorCan` (spins at real rpm), `icPackage`, `chargeTank`; layout consts `LANE`, `R_SCALE`, `RS`, `CELL_H`, `cellFraction`.
- `crystal` — `siliconCrystal` (flat Si lattice: bond pairs, donors/acceptors that ionize, free electrons, hopping holes, drift, net crossings, `track`ed hole; `wrap: false` + `junction` step: depletion zone, injection, breakdown pairs, contacts).
- `displays` — `segmentDisplay`, `pulseLabel`, `multimeter` (`ohms` dial)/`probe`, `scope` (`trace.scroll`/`draw`, `level`), `ivScreen` + `ticks`, `phasor`.
- `plots` — `formulaTriangle`, `voltScale`, `areaPlot`, `voltStack`, `inOutBars`.
- `heat` — `heatGlow`, `thermometer`, `heatWaves`, `smoke`.
- `mosfet` — `mosfetDie` (n/p cross-section: wells, gate on oxide, depletion ions, channel ∝ `channelOverdrive`, carriers, heat), `fetPart` (real 2N7000 TO-92 / IRLZ44N TO-220, pins d/g/s); square-law model `mosfetDrain`/`cmosInverter`/`inverterStep`, parts `fetSwitch`/`thresholdAt`/`junctionTemp`/`gateDrivePeriod` (`MOSFETS`, `FET_PARTS`) in `core/physics`.
- `bjt` — `transistorPart` (TO-92 on its side, legs C/B/E to the left, die glow + heat; `litEpoxy`, `partLetter`), `bjtDie` (NPN slab: electrons E → C, holes from B); model `bjtSwitch`/`bjtCollector`/`baseResistorFor` (`BJTS`), `motorAmps`/`motorRpm` (`TT_MOTOR`) in `core/physics`.
- `relay` — `relayPart` (cut-open relay: coil on a glowing core, hinged armature + spring, COM/NO/NC pins down, `contactLane`, optional case), `ssrPart` (IR LED → photo die → triac); model `SRD_05` pull-in/drop-out/`operateTime`/`releaseTime`, `SSR_25DA`, `zeroCrossConducts` in `core/physics`; `flybackStep` takes `onVolts`/`breakdownV`/`floorV`.
- `switches` — `tactSwitch` (cut-open 6 mm tact: snap dome over a centre pad, `set(press, closed)`), `toggleSwitch` (MTS-102 SPDT: bat lever, rocker, lugs a/com/b, `tip(u)`); model `SWITCHES`, `bounceEdges`/`bouncedState`, `rcDebounceStep`, `schmittHigh`, `debounceStep`, `latchToggle` in `core/physics`.
- `pot` — `rotaryPot` (cut-open 16 mm pot: carbon track tinted by potential, wiper + knob, pins a/w/b, `track(s)`/`trackAt`, `tops`); model `potDivider`, `taperFraction` (A taper 10 % at half turn), `attenuationDb`, `perceivedLevel` in `core/physics`.
- `protection` — `glassFuse` (5×20 mm, straight or coiled slow-blow element, `set(heat, melt)`: glows, parts into beads, soots the glass); model `FUSES`/`fuseStep`/`fuseMeltTime`/`fuseI2t`, `reverseGuard` (none/diode/P-FET), `seriesDiode`, `P6KE15A`/`surge`/`tvsNode` in `core/physics/protection`.
- `oscillator` — `hc49Crystal` (cut-open HC-49/U: quartz blank on spring clips, `set(strain, volts)` shears/flexes it, electrodes tinted by potential), `clockFace` (bright vs ghost true-time hands); BVD model `HC49_16M`/`motionalResponse`/`responseDb`, `loadCapacitance`/`pullPpm`, `driftPerDay` in `core/physics/oscillators`.
- `story` — `storySlider` (Step 0 loops all, k holds step k), `storyClock` (per-step seconds, `done(k)`) for stepped anim lessons.
- `fields` — `fieldLines`, `arrowGrid`, `chargeBall`, `compass`, `coil`, `inductorCoil` (cored, glows), `coilLines` (cached coil field lines + depth), `turnAboutX`/`dimField`, `barMagnet`.

## Pacing

- Serial: one agent at a time; next starts only after the last finishes.
- Gate before each spawn: memory pressure = 1, free disk > 20 GB, loadavg(1m) < 15 for one agent (< 10 for two). Else wait for the hourly check.
- After each section (category) is done: one cleanup agent before the next topic — split/dedupe shared code (`lessons/fx/`, `core/`), drop dead code, compact this file and `DESIGN.md`. No behaviour change.
- Hourly check: read git log + this file, check load; speed up (2 agents in parallel, on different categories) only if the Mac is idle and the last runs were clean; pause on red tests or overload.
- Builds/tests run with `nice -n 10`.
- After each topic commit: install on the iPhone from the clean worktree `/tmp/robo-sims-install` (`git checkout --detach <hash>`, then `nice -n 10 make ios-build ios-run`), so agents' uncommitted edits never get bundled. Its `node_modules` is an APFS clone (`/bin/cp -cR`); a symlink breaks Metro.

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
- [ ] Op-amp
- [ ] Voltage regulators
- [ ] Logic gates
- [ ] Memory cell

### Later waves (file order within each)
- Wave 3: Digital, Power, Signals
- Wave 4: Microcontrollers, Sensors, Software
- Wave 5: Actuators, Mobility, Control, Kinematics, Perception, Navigation, AI
- Wave 6: Mechanics, Waves, Math, Materials, Printing
- Wave 7: Practice (projects, challenges, debugging, workshop)
