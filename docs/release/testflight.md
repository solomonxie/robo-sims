# TestFlight external testing

App Store Connect → TestFlight → External Testing → **+** group → add the build. First build of a version goes through Beta App Review (~1 day).

## Test Information

Beta App Description (≤4000):

```
Robo Sims is a 3D workbench for learning electronics without owning parts. Orbit, pinch and tap real-size components (18650 cell, LED, resistor, ESP32, L298N, HC-SR04, motors, wheels), watch current flow in X-ray view, and swap parts to see the numbers change.

No account, no network; all content is built in.

What's in this beta (early milestone):
• Bench: an 18650 lights an LED through a resistor; swap the resistor and the live current updates (I = (V − Vf) / R)
• X-ray current view
• Learn: first interactive 3D lesson, "Current"
• Parts list and single-part viewer with 16 datasheet-sized models

Placing parts and wiring are not in this build yet.
```

Feedback Email: `you@example.com`

## Contact Information

| Field | Value |
|---|---|
| First Name | TODO |
| Last Name | TODO |
| Phone number | TODO — yours, with country code (`+1 …`) |
| Email | `you@example.com` |

## Sign-In Information

Sign-in required: **off** (no account in the app). Leave User Name / Password blank.

Review Notes: paste the App Review Notes block from [listing.md](listing.md) if present.

## Per build: What to Test

```
Orbit, pinch and pan the bench; tap each part to inspect it. Swap the resistor and check the LED current changes. Toggle X-ray. Run the "Current" lesson to the end. Open every part in the Parts list. Report any 3D glitch, slowness or crash with your iPhone model via TestFlight.
```
