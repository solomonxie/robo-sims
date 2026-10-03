# Planned surfaces — designed, not built

These are the three HTML panels in `../DESIGN.md` §3's architecture
diagram. **None of them exists in the code yet**; drawn here so the
milestone work has a picture to build against.

## Parts palette — M1 (not built)

```
┌──────────────┬───────────────────────────────────────────────────────┐
│ 🔍 Search    │                                                       │
│ PASSIVES     │                                                       │
│ ▬ resistor   │            the 3D canvas, unchanged                   │
│ ⊣⊢ capacitor │                                                       │
│ ◈ thermistor │      drag a palette row onto the board ⇒ a placed     │
│ SENSORS      │      part at that hole, with the catalog's specs      │
│ ◉ HC-SR04    │                                                       │
│ ◉ DHT11      │                                                       │
│ ◉ MQ-2       │                                                       │
│ ◉ PIR        │                                                       │
│ MCU          │                                                       │
│ ▭ ESP32      │                                                       │
│ DRIVERS      │                                                       │
│ ▭ L298N      │                                                       │
│ POWER        │                                                       │
│ ▮ 18650 cell │                                                       │
│ ▭ UBEC       │                                                       │
│ MOTION       │                                                       │
│ ⊙ TT motor   │                                                       │
│ ⊙ mecanum    │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
 ~20–25 curated parts, grouped by what they are for, not by vendor
```

## Inspector — M2 (not built)

Where a part's specs are read and changed. "Digital behaviour" means
setting a GPIO's state or PWM duty **here** — there is deliberately no
firmware emulator.

```
                                    ┌────────────────────────────┐
                                    │ R1  resistor-220ohm    ✕   │
                                    │ ────────────────────────   │
                                    │ SPECS                      │
                                    │ ohms              220      │
                                    │ tolerance         ±5%      │
                                    │ power rating      0.25 W   │
                                    │ ────────────────────────   │
                                    │ PLACEMENT                  │
                                    │ pins       E7 · E10        │
                                    │ net        N3 · N5         │
                                    │ ────────────────────────   │
                                    │ [ Duplicate ] [ Delete ]!  │
                                    └────────────────────────────┘
 an ESP32 selected ⇒ GPIO rows instead:
                                    │ GPIO 12    [ HIGH | Low ]  │
                                    │ GPIO 13    PWM  ├──●───┤ 60%│
```

## Virtual multimeter — M3 (not built)

```
                       ┌──────────────────────────────────┐
                       │ Multimeter                   ✕   │
                       │ [ V | A | Ω ]                    │
                       │  ┌────────────────────────────┐  │
                       │  │        3.28 V              │  │ ← mono, large;
                       │  └────────────────────────────┘  │   the reading is
                       │ probe +   E7                     │   the panel
                       │ probe −   GND rail               │
                       │ ────────────────────────────     │
                       │ Compare against your real build. │ ← what this is
                       └──────────────────────────────────┘   FOR: visual
                                                              comparison, not
                                                              a telemetry link
```

Current flow shows on the canvas itself (M3) rather than as a number in a
panel — the whole point is seeing where it goes.

## Out of scope, permanently

```
✗ an MCU/firmware emulator running real Arduino/MicroPython code
✗ a live USB/WebSerial link to real hardware
```

Both are named here because a simulator that looks like it might do them
invites the question on every screen.
