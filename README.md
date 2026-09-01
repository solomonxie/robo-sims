# 3D Electronics Workbench Simulator

> 🚧 Work in progress — M0 scaffold only: a breadboard and one draggable
> resistor. Wiring and circuit simulation are not built yet — see the
> roadmap in [DESIGN.md](DESIGN.md).

Drag real electronic parts onto an infinite 3D canvas, wire them together
hole-by-hole on a breadboard, and simulate the circuit — current flow,
voltages you can probe with a virtual multimeter, LEDs lighting up (or not,
with a reason why). Built to learn electronics/robotics hands-on without
needing to own every part first.

Not a SPICE-accurate EDA tool. It's a teaching tool that generalizes
Ohm's-law-level circuit math into something live and visual — see
[DESIGN.md](DESIGN.md) for the architecture, simulation model, and roadmap.

## Quick start

```sh
npm install
npm run dev       # http://localhost:5173
npm run test      # simulation engine unit tests
npm run build      # production build
```

## License

MIT — see [LICENSE](LICENSE).
