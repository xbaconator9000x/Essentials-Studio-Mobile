# Essentials Studio Mobile — authoritative UI/UX development directive

**Effective:** 16 November 2026 (Australia/Brisbane)  
**Repository:** [xbaconator9000x/Essentials-Studio-Mobile](https://github.com/xbaconator9000x/Essentials-Studio-Mobile)  
**Existing PR:** [#97](https://github.com/xbaconator9000x/Essentials-Studio-Mobile/pull/97)  
**Branch:** `copilot/android-real-project-and-sprite-editor-20261105`

## Scope and authority

Actively implement the Android-first mobile application's navigation, user interface, screen-space management, touch ergonomics, responsive layouts and directly necessary React/TypeScript/CSS/Tauri/Rust integration fixes. This is direct development rather than a mockup, audit or consultation. Inspect live code, make functional changes, add regression/integration tests, commit and push to **existing PR #97 only**, inspect exact-HEAD CI and repair regressions. No new PR, fork, issue, competing coding agent or paid infrastructure. Coordinate with already-running Copilot and GitHub Actions work.

## Branch discipline

Before every batch, fetch PR #97 and the live branch SHA, inspect recent commits, overlap and exact-HEAD workflows. Never reset to an earlier handover SHA or overwrite concurrent edits. Prefer cohesive, isolated changes. Commit by creating a tree and commit against the verified parent, then update the existing ref using an expected-head lease; on rejection re-fetch, reconcile and retry safely. Do not force-overwrite unrelated work. Do not initiate redundant CI reruns. A documentation-only milestone is a prerequisite, not a substitute for working UI changes.

## Functional requirements

- **Shell and navigation:** coherent portrait/landscape navigation to Projects, Maps, Sprites, Settings, and functional entry to Event, Database, Scripts and PBS editors as supported; obvious active view; preserve mounted project/editor edits, selected map and context; minimise chrome and keep canvas space; Android cutouts, navigation insets and keyboard avoidance; desktop intact. Never show inert destinations.
- **Maps:** large viewport, reliable existing pinch zoom/pan, explicit separation of navigation and paint gestures; brush/erase/fill/selection where supported, compact layer controls, layer visibility, accessible palette, event selection, undo/redo, 44px touch targets. Keep source-backed mutation services; exact map dimensions, RMXP layers, tile IDs and events.
- **Tilesets:** smooth non-destructive scroll, zoom, visible selection, individual/region/autotile selection where supported, recent tiles, oversized tilesets and valid RMXP bounds, no accidental painting while palette is scrolled.
- **Sprites:** reliable touch painting/panning/pinch, pencil/erase/fill/picker/selection where supported, collapsible tools, colour palette, direction/frame preview and navigation, undo/redo, import/export, Save All, keyboard-safe dialogs; preserve source sprite data and accepted transformations.
- **Events:** touch selection, properties, page navigation, command lists, dialogue/text, coordinates, Save/Cancel/Done with keyboard-aware layout; preserve complete RMXP Marshal event structures, including unsupported commands.
- **Projects:** recent selection/search, safe switching with dirty-work prompt, operation lock, Save All, ZIP export/import, progress and errors, unchanged project context and fidelity.
- **Shared design:** reusable accessible controls, consistent toolbars, sheets, inputs, focus, feedback, disabled states, theme variables; no one-off desktop breakage.

## Invariants and safety

Maintain Pokémon Essentials v21.1, RMXP format/Marshal fidelity, Shattered project support, Android native bridge, map/event/source data integrity, Save All, project switch gate, ZIP roundtrip/reimport, native persistence, accepted prior test gates and working desktop UI. No alternative Android-only editor data model. No private ROMs/saves/project assets, unlicensed graphics, proprietary inputs, credentials, signing certificates, secrets, compiled APKs or binaries in public commits. Never silently discard edits.

## Sequence and acceptance

1. Application shell/navigation, portrait space, shared actions.
2. Map gestures, painting ergonomics, tilesets/layers/palette.
3. Sprite touch workflow, frames, tools and saving.
4. Events, forms, projects and file operations.
5. Shared components, redundant control removal and cross-editor navigation.
6. Build/test evidence, Android ARM64 APK artifact, explicitly outstanding physical-device acceptance.

Prioritise complete operational user journeys rather than tiny cosmetic changes. Definition of done: usable major editing flows in portrait with working navigation and touch handling, fitting forms, correct map/sprite/event and project persistence, protected switching, Save/ZIP fidelity, intact desktop, passing required CI, downloadable experimental ARM64 APK, and documented deferred physical testing. Native emulator/KVM and physical acceptance are **not proven by web tests or by an APK build**.

## Reporting and continuity

Every batch report the exact new HEAD/commit(s), production/test files, functional behaviour, exact-head checks and failures, APK artifact URL + ID + GitHub-reported ZIP SHA-256 when available, one primary blocker, next concrete task and overlapping development. Distinguish implemented, locally tested, CI-verified and real-device accepted. Update `CONTINUATION_STATE.md` and `UI_IMPLEMENTATION_PLAN.md` on meaningful milestones. On handover, first read all four documents in this directory, compare against live PR/commits and amend stale continuation data rather than undoing newer work.

**Distribution:** GitHub Actions artifacts are the default for experimental ARM64 builds, with source SHA, run, artifact ID/link and GitHub-reported ZIP SHA-256. Keep within free retention/storage. No binaries or APK ZIPs to ChatGPT Library or public source commits; no stable release without explicit authorisation. See [TESTING_AND_RELEASE_POLICY.md](TESTING_AND_RELEASE_POLICY.md).
