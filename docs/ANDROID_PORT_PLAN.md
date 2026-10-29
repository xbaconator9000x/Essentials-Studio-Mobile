# Essentials Studio Mobile — Android Port Plan

> Work branch: `feature/android-ci-bootstrap`
> Upstream: [doranteseduardo/rmxp-editor](https://github.com/doranteseduardo/rmxp-editor)
> Goal: edit an **existing**, unchanged Pokémon Essentials v21.1 / RPG Maker XP project on Android and safely export a project that desktop editors can reopen.

## Scope boundaries

- **Keep native XP `.rxdata` and Essentials PBS formats.** Do not convert to MV/MZ or invent a different runtime.
- Preserve the upstream React map, event, database, PBS and script editors wherever possible.
- Android ARM64 first. Web/iOS and built-in game playback are postponed.
- Do not modify PokéBacon Studio, Pokémon Shattered, or the upstream repo.
- Do not ship public releases until upstream redistribution/licence terms are verified. Upstream README says MIT, but there is no separately detected LICENSE file.
- Never mark a feature completed merely because a UI exists; require actual data round-trip and test evidence.

## Architecture decision

The existing React frontend uses `src/services/tauriApi.ts` to issue Tauri commands. The Rust backend parses/writes Ruby Marshal files, scripts, Pokémon Essentials PBS text and assets. Preserve this boundary.

Android-specific adaptations:

1. Tauri v2 ARM64 bootstrap and CI compile probe.
2. Remove desktop-only native dependencies (initial audio preview stub on Android).
3. Import a project ZIP through the Android document picker. Validate entries and ZIP limits; extract to **application-private storage**, never to arbitrary external paths. Keep the original archive immutable.
4. Open the extracted project via existing `open_project`, `load_map`, `save_map`, `load_event`, `save_event` and PBS commands. Add a secure, platform-aware project-path resolver.
5. Resolve assets from the private project directory through Tauri's Android asset protocol or a scoped native command. Do not assume `file://` or `https://asset.localhost` works without validation.
6. Export a replacement ZIP to a user-selected document destination. Verify the output on desktop and compare untouched input files byte-for-byte.
7. Only after round-trip integrity: touch controls, gestures, narrow layouts and optional previews.

## CI probe

`.github/workflows/android-probe.yml` runs on the Android development branch and on pull requests to main. It:
- validates the queue; builds/lints React;
- installs Java 17, Android SDK/NDK, ARM64 Rust target;
- initialises Android through Tauri v2;
- attempts an **ARM64 debug APK** (not a signed public release);
- keeps diagnostic reports and the debug build as short-lived GitHub Actions artifacts if compilation succeeds.

The first compile may fail. Read the actual compiler/Gradle logs and fix the earliest *root cause* on this branch; do not disable editor features as a shortcut without recording it in the queue.

## Scoped Android graphics loading (draft PR #3)

The original desktop image loader resolves `Graphics/Tilesets`, `Graphics/Autotiles` and `Graphics/Characters` through Tauri's asset URL protocol. Android WebView asset protocol support for app-private imported projects is not yet verified.

The Android-specific path now requests a named image through `read_private_project_image`. Rust checks the canonical imported project directory, known graphics asset type, flat filename, symlink confinement and a 32 MiB per-image limit, then returns an image `data:` URL. The browser caches decoded images by a short project/asset key rather than by a large base64 string. Desktop remains on its existing asset protocol path.

**Remaining gates:** Confirm on an actual Android ARM64 device that tilesets, autotiles and event characters render correctly from a real Essentials v21.1 project, that memory remains bounded for large graphics, and that all other asset access paths are similarly confined. Until then ASM-006 is not complete. This is a temporary correctness-first transport, not a claim of efficient streaming for every asset size.

## Android document export bridge (draft, not device-verified)

The Android save dialog returns a scoped `content://` URI, not a native
filesystem path. A native `save_project_archive_to_document` command now
streams the already-validated app-private ZIP through Android's
`ContentResolver.openOutputStream(uri, "wt")` in bounded chunks, closes the
document, reopens it with `openInputStream`, and compares the saved bytes to
the original archive before reporting success. This avoids constructing a
512 MiB ZIP Blob inside the WebView and avoids assuming the filesystem plugin
can write document-provider URIs reliably.

The document URI is accepted only with a `content://` authority and is
granted by the Android picker. The original imported ZIP and private project
are not overwritten. A failed provider write may leave a partial *newly
selected destination document*; the user must retry or remove that file.
No broad Android external-storage permission is requested.

**Remaining acceptance:** ARM64 JNI compile, physical-device document-picker
write/readback, provider cancellation and failure handling, and independent
desktop reopening of a real Pokémon Essentials v21.1 project. Native
compilation and synthetic tests alone do not complete ASM-005.

## Acceptance gates

**Gate A — Build:** Android ARM64 debug APK compiles; frontend build passes. Evidence: GitHub Actions run and APK artifact.

**Gate B — Storage:** project archive import/export with ZIP traversal and decompression-bomb defences; no accidental overwrite of original. Evidence: automated tests and sample project archive.

**Gate C — XP fidelity:** map layers, autotiles, passages, event pages, scripts, metadata, Pokémon PBS files and unknown fields preserved. Evidence: independent read-save-reopen comparisons.

**Gate D — Mobile usability:** map paint/pan and event editing work without right-click, hover or a hardware keyboard. Evidence: real Android device testing with saved state.

**Gate E — Release:** upstream licence resolved, APK signed, smoke tests pass, documentation complete. No automatic GitHub Release before this gate.

## Durable work queue

Source of truth: `development/queue.json` on **main** after review and merge. While this PR is open, its branch is the proposed next state.

`node scripts/check-development-queue.mjs` verifies task IDs, valid states, dependencies, cycles and evidence for completed tasks.

Task states are `todo`, `in_progress`, `blocked`, `done`. Promote only on tested evidence. Each completed task records tests/commits/build URLs. Avoid duplicated work by checking the live main branch and any open PRs before changing task ownership. The first eligible priority-0 work items are Android compilation and licensing verification.

## Important current limitations

The original `src/App.tsx` project picker expects a native directory path. Android may return a document URI; do not pass that URI directly into `std::path::PathBuf`. The initial ZIP approach is not implemented yet.

Audio preview is temporarily unavailable on Android; desktop continues using rodio. The upstream playtest launcher is already a stub and does **not** launch an Android Pokémon Essentials runtime. No gameplay compatibility is implied by a successful editor APK build.
