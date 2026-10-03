# Working in this repo

- **Physical iPhone only.** Never build for, install on, launch, or screenshot a simulator.
- Install: `make ios-build ios-run`. Release build, JS embedded.
- **No dev server.** No Metro server, no `npm start`. `AppDelegate.bundleURL` always reads the embedded `main.jsbundle`. Metro runs only as the bundler inside the Xcode build phase.
- **No Expo.** `make test` fails if an expo package appears in the lockfile.
- If no device is connected, stop and say so.
- Verify with `make test typecheck lint` by default.
