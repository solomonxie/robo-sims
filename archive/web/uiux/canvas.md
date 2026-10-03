# The canvas — M0, as built

`src/App.tsx` + `src/scene/Scene.tsx`. One `<Canvas>` filling the viewport,
one HUD line over it, nothing else.

```
┌──────────────────────────────────────────────────────────────────────┐
│ robo-sims — M0: drag the resistor, orbit with the mouse              │ ← HUD:
│                                                                      │   14px,
│      · · · · · · · · · · · · · · · · · · · · · · ·                   │   #ddd,
│    · · · · · · · · · · · · · · · · · · · · · · · ·                   │   no
│   ┌────────────────────────────────────────────┐                     │   pointer
│   │ ∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘ │ ← breadboard: cream   │   events
│   │ ∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘ │   slab (#e8e4d8),     │
│   │ ∘∘∘∘∘∘∘∘▬▬▬▬▬∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘ │   instanced dark      │
│   │ ∘∘∘∘∘∘∘∘  ↑  ∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘∘ │   holes on a 0.1"     │
│   │ ∘∘∘∘∘∘∘∘  the resistor: procedural body,  │   grid                │
│   │ ∘∘∘∘∘∘∘∘  metal leads, colour bands       │                       │
│   └──────────────────────────────────────────┘                        │
│      · gridHelper, 40×40, #333 on #2a2a2a ·                           │
│                        background #1e1e24                            │
└──────────────────────────────────────────────────────────────────────┘
```

Everything is procedural geometry — no imported models. A part's
appearance is computed from its catalog specs, so the picture and the
data can't disagree:

```
 resistor-220ohm  ⇒  bands red · red · brown   ← resistorColorBands(ohms)
 a spec change repaints the part; there is no second source of truth
```

## Selection and dragging

```
 click a part        ⇒ selected: a blue (#4da6ff) wireframe hull around it
 click empty space   ⇒ deselected (onPointerMissed)
 drag a part         ⇒ it follows the pointer on the y=0 plane
 drag empty space    ⇒ orbit the camera
```

One drag, one meaning: `OrbitControls` is **disabled** while a part is
being dragged. It listens on the raw canvas element rather than through
R3F's event system, so `stopPropagation()` alone would still let a part
drag rotate the camera underneath it.

```
 camera  position [3, 3, 4], fov 50 — a three-quarter view, so the board
         reads as a board and parts read as sitting on it
 light   ambient 0.6 + one directional (3, 5, 2) at 1.2, casting shadows —
         the shadow is what makes a part look placed rather than floating
```

## What the HUD says

```
 robo-sims — M0: drag the resistor, orbit with the mouse
```

The only text on screen names the milestone and the two gestures that
work. A scaffold that says what it is beats one that looks broken.
