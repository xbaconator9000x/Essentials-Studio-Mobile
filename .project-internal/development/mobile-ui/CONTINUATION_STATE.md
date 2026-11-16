# Mobile UI development continuation state

**Recorded:** 16 November 2026 AEST.  
**PR:** [#97](https://github.com/xbaconator9000x/Essentials-Studio-Mobile/pull/97) in `xbaconator9000x/Essentials-Studio-Mobile`.  
**Branch:** `copilot/android-real-project-and-sprite-editor-20261105`.

## Current authoritative checkpoint

Last verified HEAD before writing this file: `b6efb521dd3eb05ba4103d92cef79944becfe000` (the *new* documentation commit has its own later SHA). On every resumption obtain live PR HEAD and reconcile source/CI rather than resetting to this entry.

### This handover's source-controlled development

- `28e61a10ead3d20fb982203f8c15a18ca7e6be67`: created all four authoritative guidance documents in this public dot-prefixed directory.
- `b6b48112aa5c4860a39e6aac87d58ac240c81569`: new functional `MobileBottomNavigation`, 44px touch/active/busy/no-map controls; `MobileWorkspaceBar` always-visible Save/ZIP and expandable map/project tools; collapsible project import/recent list; reduced duplicate Settings chrome; rendered UI and CSS tests.
- `f2e0cbe1f5d68edf938920266cdf9855c0b41188`: retained explicit Save/Export positioning under the portrait CSS regression.
- `adc7ed2005b84ffdb5acaafdd1741010bf4f587b`: `TilesetPalette` pointer-drag vs click guard, native vertical scroll, 48px Paint with selected tile button, touch tests, unchanged tile ID/mutation services.
- `c6bf4b2f3129e6400cfb5a974d862e444aef8241`: updated *real* Chromium browser-ui-smoke portrait and landscape steps to open the map/project disclosure controls before editing, while retaining canvas-height, toolbar-height, accessibility, persistence and ZIP roundtrip assertions. This repairs the new-shell interaction route without weakening checks.
- `b6efb521dd3eb05ba4103d92cef79944becfe000`: JSDOM regression harness now supplies MouseEvent-compatible PointerEvent coordinates to test pointer swipe accurately; gesture assertions unchanged.

### Verified test evidence and pending

At `b6b4811`, Android APK workflow's TypeScript frontend test job passed (including mobile component tests) and XP painting suite passed; [browser bridge run 43878809158](https://github.com/xbaconator9000x/Essentials-Studio-Mobile/actions/runs/43878809158) **failed** because the old Chromium script looked for the newly disclosed Edit button without expanding Map tools. Browser journey was repaired at `c6bf4b2`; check its/newer exact-HEAD run before calling it passed.

At `f2e0cbe`, eight workflows (including XP paint, event Marshal, source integrity, editor save and archive) completed SUCCESS, [Android APK probe 43879321895](https://github.com/xbaconator9000x/Essentials-Studio-Mobile/actions/runs/43879321895) completed SUCCESS, but browser bridge failed for the old disclosure path. At `adc7ed2`, [XP painting run 43880719954](https://github.com/xbaconator9000x/Essentials-Studio-Mobile/actions/runs/43880719954) **failed** in new tile touch regression because JSDOM's fallback PointerEvent omitted `clientX/clientY`. Fixed its pointer-event test fixture at `b6efb52`. All latter results need re-verification. Never treat earlier-head passes as current-head acceptance.

### APK distribution

A verified *earlier-head* debug ARM64 APK from docs-only commit `28e61a1`: [run 43877663596, artifact 14231915119](https://github.com/xbaconator9000x/Essentials-Studio-Mobile/actions/runs/43877663596/artifacts/14231915119); GitHub-reported artifact ZIP SHA-256 `ffa9892a9a2bf15206022218d7327f63df385b2b49bbb9623fb1edbfb83fa8d4`. **It does not contain the new mobile UI changes.** Retrieve exact-HEAD artifact ID/digest for a current APK before offering a new UI APK. Do not upload binaries to ChatGPT Library, public commits or stable releases.

## Priority next task

1. Confirm exact-HEAD browser/XP-paint tests after `c6bf4b2` and `b6efb52`; fix any remaining actual failures without weakening assertions.
2. Continue Phase 2 coherent map/palette gesture/tool switch ergonomics, then sprites and event editor.
3. Preserve other contributors' changes, working desktop, RMXP/Event Marshal/persistence, all project ZIP fidelity.

**Primary acceptance blocker:** physical Android touchscreen/portrait/landscape verification is still deferred, and passing an APK build or Chromium test must not be called physical acceptance. Emulator/KVM status is separately reported and never assumed passed.

Read [DEVELOPMENT_DIRECTIVE.md](DEVELOPMENT_DIRECTIVE.md), [UI_IMPLEMENTATION_PLAN.md](UI_IMPLEMENTATION_PLAN.md), this file and [TESTING_AND_RELEASE_POLICY.md](TESTING_AND_RELEASE_POLICY.md) on handover. Live source and CI supersede dated snapshots.
