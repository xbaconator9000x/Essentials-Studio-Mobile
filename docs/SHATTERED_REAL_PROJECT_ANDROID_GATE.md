# Shattered real-project Android editor: integration acceptance gate

**Status: not passed.** This is the immediate integration target for Essentials Studio Mobile, independent of the Shattered game implementation repository.

## Product promise
On a standard supported Android ARM64 phone, open an **authorised Pokémon Essentials v21.1 / RPG Maker XP project** through a project ZIP, edit genuine map tiles **and event commands**, save, export a new ZIP into a user-selected Android document, reopen that ZIP in a desktop-compatible RMXP/Essentials reader, then launch the edited project in JoiPlay/NaviaXP. Native builds and synthetic tests alone cannot certify these steps.

## Minimal repeatable real-user acceptance scenario
1. Back up the original playable Shattered Essentials demo. Import its valid ZIP via the Android document picker; original ZIP bytes must remain unchanged. Show actionable messages for invalid archives and project roots.
2. Open a real map: visually render correct XP **three-layer** tiles, autotiles, character graphic, collision and event overlay, not a flattened bitmap. Load a real event with page conditions, route and script commands intact.
3. Modify **one map tile**, **one dialogue event** and **one PBS field** (or leave PBS untouched for a narrower first acceptance). Save and close/reopen that project in the app. Confirm edits persist.
4. Export a full ZIP through SAF `content://` provider. The output byte readback must match the archive submitted to the provider. Handle cancellation, permission failures, low storage and partial write without falsely claiming success.
5. Compare original and exported ZIP manifests with `scripts/verify_project_roundtrip.py`, explicitly allowing only the known modified `Data/MapNNN.rxdata` and relevant PBS path. Unedited files must remain byte-identical, including scripts, graphics, metadata, unknown fields and original encodings.
6. On a desktop Essentials/RPG Maker XP environment, open the edited project and execute the event. Independently confirm that its executable/game runtime starts in JoiPlay/NaviaXP on Android and the changed dialogue can be observed.
7. Capture the build SHA, APK version, Android provider/device details, input/output ZIP hashes, allowed changed paths, script and map integrity receipts, screenshots/errors and a clear pass/fail matrix.

## Core engineering priorities
- **ASM-005 / PR #12:** Android scoped SAF export is present as a draft with synthetic validation, but not real provider/device verification. Finish code/test/integration against current main, without altering unrelated editor modules.
- **ASM-004:** Project ZIP import, correct project-root discovery and Tauri app-private path routing must lead to the actual `open_project` backend. The original desktop backend currently requires `Game.rxproj`, `Data/MapInfos.rxdata`, `System.rxdata`, `Tilesets.rxdata`; audit actual v21.1 project inputs rather than assuming an exported ZIP is valid.
- **ASM-006:** Graphics/Tilesets, Autotiles and Characters must resolve from the imported app-private project in Android without unsafe filesystem paths or massive WebView memory usage.
- **ASM-007/008/009:** Preserve map layer Table data, original event commands and Ruby scripts, PBS comments/newlines/unknown lines; use existing native/JS regression tests and non-redistributed user-provided samples.
- **ASM-011:** Manual device test is still required. No agent should assert it passed without an actual device/provider session.

## CI strategy and safeguards
- Use **small, sanitised, rights-cleared synthetic RMXP project fixtures** for repository tests; never upload the supplied game files, ROMs, Pokémon art, commercial music or secrets to a public repo.
- Add executable tests for the same pipeline, not just summaries. Check a sample "project ZIP → imported root → map/event/PBS operations → export ZIP → independent comparison" on CI where feasible, and isolate Android-only `content://` provider tests behind explicit mocks/instrumentation.
- A compile success is **Gate A only**. Real on-device and desktop-reopen gates remain open until user evidence exists.
- Keep existing draft PR #12 ownership of SAF export; avoid a second Copilot branch editing those files. Target the missing acceptance test on that PR.
- Minimise workflow spend: queue handoff runs need not run every five minutes. No paid overages or unattended Copilot delegation.
- The eventual game and editor must remain separate repos; do not use editor APK results to declare Shattered itself ready.

## Release decision
Only claim end-to-end working after a logged real **import → edit → save → export → desktop reopen → Android game playtest**. For a genuine user's project, any unmet stage is a blocker, not a presumed pass.
