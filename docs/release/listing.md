# Publishing Robo Sims — step by step

Every field below is ready to paste. `TODO` = only you can supply it.
App Store Connect paths start at **Apps → Robo Sims → Distribution →**.

| | |
|---|---|
| Bundle ID | `PRODUCT_BUNDLE_IDENTIFIER` in `app/ios/Local.xcconfig`, else `com.example.robosims` |
| SKU | `robosims-ios` |
| Version | `1.0` (`MARKETING_VERSION`) |
| Build | `CURRENT_PROJECT_VERSION`; bump for every upload |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`) — no iPad screenshots needed |
| Min iOS | 15.1 |
| Privacy Policy URL | `https://github.com/solomonxie/robo-sims/blob/master/docs/release/privacy-policy.md` |
| Support URL | `https://github.com/solomonxie/robo-sims/issues` |

---

## 1. Prerequisites

- [ ] Paid Apple Developer membership active; no pending agreement banner in App Store Connect → Business. Free app: no banking needed.
- [ ] Xcode → Settings → Accounts signed in; `DEVELOPMENT_TEAM` in gitignored `app/ios/Local.xcconfig` (never commit).
- [ ] `make test typecheck lint` pass.
- [ ] `make ios-build ios-run` on the iPhone; smoke-test Bench, X-ray, Learn → Current, Parts. Never a simulator.

## 2. Create the app

**Apps → + → New App**

| Field | Value |
|---|---|
| Platforms | iOS |
| Name | `Robo Sims: Electronics Lab` |
| Primary Language | English (U.S.) |
| Bundle ID | yours (dropdown; created by automatic signing on first device build) |
| SKU | `robosims-ios` |
| User Access | Full Access |

If the name is taken: `Robo Sims 3D`, `Robo Sims – Learn Electronics`.
Home Screen label stays `Robo Sims` (`CFBundleDisplayName`).

## 3. Archive and upload

Xcode: open `app/ios/RoboSims.xcworkspace` → destination **Any iOS Device (arm64)** → bump build number → Product → **Archive** → Organizer → **Distribute App** → App Store Connect → Upload.
Processing: 15–60 min, then an email. "Upload Symbols Failed" for hermes/React frameworks is harmless.

## 4. TestFlight

See [testflight.md](testflight.md). Install the TestFlight build on the iPhone and smoke-test it — it's the exact binary Apple reviews.

## 5. Submit

- [ ] `iOS App → 1.0 Prepare for Submission` → **Build** → **+** → pick the build.
- [ ] All pages below filled; App Privacy published.
- [ ] **Add for Review** → **Submit for Review**. Review typically 24–48 h.
- [ ] After approval: **Release This Version**, then `git tag v1.0 && git push --tags`.

---

## Screenshots

Slot **iPhone 6.9" Display**: `1320 × 2868`, portrait, JPEG/PNG without alpha. Capture on the iPhone (side button + Volume Up), full battery, no notifications. Upload in this order:

1. **Bench** — parts laid out, LED lit
2. **X-ray** — current view on the bench
3. **Lesson: Current** — 3D stage with formula and slider
4. **Learn** — lesson list
5. **Parts** — parts list
6. **Part viewer** — DHT11 with specs

Captured on an iPhone 14, resized to 1320 × 2868 JPEG in `docs/release/screenshots/6.9/`.

App Preview video: skip for 1.0.

---

## App Store Connect pages

### `iOS App → 1.0 Prepare for Submission`

| Field | Value |
|---|---|
| Previews and Screenshots | [Screenshots](#screenshots) |
| Promotional Text | below |
| Description | below |
| Keywords | below |
| Support URL | `https://github.com/solomonxie/robo-sims/issues` |
| Marketing URL | leave blank |
| Version | `1.0` |
| Copyright | `2026 solomonxie` |
| Build | the uploaded build |
| App Review → Sign-In Required | Off |
| App Review → Contact First / Last Name | `Solomon` / `Xie` |
| App Review → Phone | TODO (with country code, e.g. `+1 …`) |
| App Review → Email | `you@example.com` |
| App Review → Notes | below |
| App Review → Attachment | none |
| Version Release | **Manually release this version** |

Promotional Text:

```
A pocket electronics workbench. Orbit real-size parts in 3D, light an LED from an 18650 cell, swap the resistor and watch the current change. Offline, no account.
```

Description:

```
Robo Sims is a 3D workbench for learning electronics and robotics without owning the parts. Orbit, pinch and tap real-size components, build a circuit that actually works, and see the numbers change when you swap a part.

BENCH
• An 18650 cell lights an LED through a resistor
• Swap the resistor and the LED dims or brightens, with the live current worked out from I = (V − Vf) / R
• X-ray view shows current flowing through the circuit

LEARN
• Interactive 3D lessons explain the physics underneath
• Starting with Current: charge, flow and what a resistor really does
• Every number shown comes from the same Ohm's-law formulas

PARTS
• 16 datasheet-sized models: 18650 cell, LED, resistor, breadboard, ESP32 DevKit, L298N motor driver, HC-SR04 ultrasonic sensor, TT motor, wheels and more
• Open any part in a single viewer, orbit it and inspect it up close

Robo Sims is a teaching tool, not a circuit simulator for professional design. Placing parts, wiring your own circuits and a robo-car build are on the way.

Everything runs on your iPhone. No account, no network access, no ads, no analytics. Free.
```

Keywords:

```
electronics,circuit,arduino,esp32,led,resistor,ohm,breadboard,robotics,stem,physics,current,3d
```

App Review Notes:

```
No account or login. The app opens straight into the Bench; all content is built in and works offline.

PURPOSE AND AUDIENCE
Robo Sims is an educational tool for students and hobbyists learning electronics and robotics. It shows real-size components in 3D and simple working circuits, so users can see how parts and values affect a circuit without buying hardware.

HOW TO USE THE MAIN FEATURES (no setup needed)
- Bench tab: drag to orbit, pinch to zoom, two fingers to pan, tap a part to inspect it. Swap the resistor and the LED brightness and current readout change. Toggle X-ray to see current flow.
- Learn tab: open the "Current" lesson; an interactive 3D stage with controls and a formula.
- Parts tab: list of all parts; tap one to open it in a viewer.

3D rendering uses WebGPU (Metal). Needs an iPhone that supports it.

EXTERNAL SERVICES
None. The app makes no network requests: no analytics, advertising, crash reporting, authentication or payment services. All content is bundled in the app binary.

REGIONAL DIFFERENCES
None. Identical in every region, English only.

REGULATION
Educational tool only. It does not connect to real hardware, handle money, health data or personal data. Simulated values are illustrative.

All data is stored on the device. We operate no server and receive no user data.
```

What's New: not shown for a first version.

### `General → App Information`

| Field | Value |
|---|---|
| Name | `Robo Sims: Electronics Lab` (26/30) |
| Subtitle (≤30) | `Learn circuits in 3D` (20) |
| Category — Primary | Education |
| Category — Secondary | Utilities — or leave blank |
| Content Rights | **No**, it does not contain, show, or access third-party content |
| Age Rating | **Edit** → all None/No → result **4+** |
| License Agreement | Apple standard EULA |
| Privacy Policy URL | `https://github.com/solomonxie/robo-sims/blob/master/docs/release/privacy-policy.md` |

Age rating questionnaire: Parental controls No · Unrestricted web access No · User-generated content No · Messaging/chat No · Advertising No · Violence, sexual content, profanity, horror, mature themes None · Alcohol/tobacco/drugs None · Medical/health None · Gambling/loot boxes None · Made for Kids No.
**Digital Services Act**: **Not a trader** (free, no monetization).

### `App Store → Trust & Safety → App Privacy`

| Field | Value |
|---|---|
| Privacy Policy URL | same as above |
| Do you or your third-party partners collect data from this app? | **No, we do not collect data from this app** |

Then **Publish**. Re-check before each submission:

```
grep -rnE "fetch\(|XMLHttpRequest|WebSocket\(|openURL" app/src app/App.tsx
grep -niE "analytics|firebase|sentry|amplitude|mixpanel|posthog|bugsnag|crashlytics" app/package.json app/ios/Podfile.lock
```

### `App Store → Monetization → Pricing and Availability`

| Field | Value |
|---|---|
| Base Country or Region | United States (USD) |
| Price | **Free** ($0.00) |
| Availability | All countries or regions |
| iPhone and iPad Apps on Apple Silicon Macs | **Off** |
| Apple Vision Pro | Off |

App Accessibility: skip for 1.0. Not needed: IAP, Subscriptions, Events, Custom Product Pages, Promo Codes.

## Export compliance

`ITSAppUsesNonExemptEncryption = false` is in `Info.plist`; no page to fill. If the build shows "Missing Compliance": **Manage** → **None of the algorithms mentioned above**.

## Localization

English only for 1.0.
