# Lesson rollout plan

Goal: turn curriculum entries (`app/src/curriculum/`) into real lessons — each a `Lesson` with an animated 3D `build()`, like `app/src/lessons/current.ts`.

## Unit of work

- One agent = one **topic** (all its entries, usually 3–4 lessons).
- Per entry: `app/src/lessons/<category>/<topic>.ts` exports one `Lesson` per entry; register in `UNITS` (`lessons/index.ts`) and `READY` (`curriculum/index.ts`, keyed by entry id).
- Lesson id = entry id without the category, `/` → `-` (e.g. `current-amps-and-the-coulomb`); `curriculum.test.ts` enforces it. Preview with `make preview LESSON=<id>` → `/tmp/<id>.png`.
- Numbers shown come from tested pure functions in `core/` (add + test new formulas there).
- Reuse `archive/lesson-drafts/` where a draft exists; shared visuals go to `lessons/fx.ts`.
- Framing: in the preview the legend covers the top ~30% (right side) and readout chips the bottom ~25%, so the scene must read in the middle band; wide (landscape) layouts fit better than tall ones.
- Visual vocabulary: potential is `potentialColor` (blue 0 V → red high; `Flow.colorBy` tints charges by position); numbers in the scene use `segmentDisplay` (no text rendering in 3D).
- Done = `make test typecheck lint` green + `make preview LESSON=<id>` renders sensibly (checked by viewing the PNG) + one local commit. No device build, no push.

## Pacing

- Serial: one agent at a time; next starts only after the last finishes.
- Gate before each spawn: memory pressure = 1, free disk > 20 GB, loadavg(1m) < 15 for one agent (< 10 for two). Else wait for the hourly check.
- Hourly check: read git log + this file, check load; speed up (2 agents in parallel, on different categories) only if the Mac is idle and the last runs were clean; pause on red tests or overload.
- Builds/tests run with `nice -n 10`.

## Queue

Order follows the drafts backlog, then the home sections. Tick when committed.

### Wave 1 — Electricity
- [x] Current
- [x] Voltage
- [ ] Resistance
- [ ] Ohm's law
- [ ] Power & energy
- [ ] Series & parallel
- [ ] Voltage divider
- [ ] Kirchhoff's laws
- [ ] Thevenin & Norton
- [ ] AC vs DC
- [ ] Electric fields
- [ ] Magnetism

### Wave 2 — Components & semiconductors (drafted first)
- [ ] Capacitor
- [ ] Diode
- [ ] LED
- [ ] Silicon & doping
- [ ] PN junction
- [ ] MOSFET physics
- [ ] Chip making
- [ ] then remaining Components, Semiconductors topics in file order

### Later waves (file order within each)
- Wave 3: Digital, Power, Signals
- Wave 4: Microcontrollers, Sensors, Software
- Wave 5: Actuators, Mobility, Control, Kinematics, Perception, Navigation, AI
- Wave 6: Mechanics, Waves, Math, Materials, Printing
- Wave 7: Practice (projects, challenges, debugging, workshop)
