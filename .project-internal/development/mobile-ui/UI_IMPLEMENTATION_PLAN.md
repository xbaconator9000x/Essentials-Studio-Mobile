# Mobile UI implementation plan

**Status as of 16 November 2026:** Active, phase 1 in progress. The real branch and CI are authoritative; see [CONTINUATION_STATE.md](CONTINUATION_STATE.md) for checkpoint.

## Phase 1 — shell, wayfinding and workspace
- [x] Existing baseline provides bottom Projects/Maps/Sprites/Settings navigation, map-organisation/view-edit controls, Save/Export command strip and preserved map-tree state.
- [x] Keep Save/Export visible while disclosing context-specific Map/Project actions.
- [x] Functional, active-state bottom navigation, disabled when no map is loaded or native operation active; switching tabs preserves mounted editor state.
- [x] Collapsible workspace actions and project ZIP/recent controls reclaim canvas/tree space; preserve existing safe-area CSS.\n- [ ] Finish keyboard-aware overlays and physically verify landscape/portrait safe areas.
- [x] Added rendered navigation, dirty/busy state and portrait CSS tests; adapted Chromium portrait/landscape journey to verify disclosure and canvas-space invariants.\n- [ ] Real-device layout acceptance outstanding.
**Acceptance:** project opens; map selection enters editor; browser/Android Back and tab switching preserve unsaved map edits; Save All/ZIP work; controls and map fit portrait; desktop unchanged.

## Phase 2 — maps and tilesets
- [ ] Validate painting vs pinch/pan gesture arbitration with tests.
- [ ] Brush/erase/fill/selection discoverability, layer and visibility status, active tools and undo/redo.
- [x] Touch swipe guards prevent scroll-induced selection; accessible Paint with selected tile returns to map with selection unchanged.\n- [ ] Complete palette zoom, region selection and further compact-panel ergonomics.
- [ ] Verify oversized tileset and RMXP maximum tile IDs without wrong edits.
**Acceptance:** open/select/edit/map-change/save/reopen/ZIP preserves tiles and events identically; palette scroll and pan cannot paint.

## Phase 3 — sprite editor
- [ ] Audit touchscreen pixel gesture conflicts and implement reliable pan/zoom without accidental drawing.
- [ ] Contextual tool grouping, colour selection, direction/frame navigation, animation preview and history.
- [ ] Import/export and dirty save integration, narrow dialogs, keyboard avoidance.
**Acceptance:** select/open/edit/move/frame-change/save/reopen/import-export does not corrupt frame boundaries.

## Phase 4 — event editors and project flows
- [ ] Narrow-screen event pages/commands/properties/dialogue with functional Save/Cancel/Done.
- [ ] Coordinate movement, keyboard-safe forms, scrollable command list.
- [ ] Project recent search, dirty-state gate, operation feedback, double-tap protection, Android ZIP roundtrip.
**Acceptance:** event edit and reopen retains all data, including unknown Marshal commands; project switch guards unsaved work; ZIP roundtrip preserves source.

## Phase 5 — consistency
- [ ] Centralise button sizes, labels, focus states, drawers and modal behaviour with shared CSS/components.
- [ ] Remove redundant controls; validate all navigation and saved/unsaved indicators on viewport rotation.
**Acceptance:** no dead links, accidental edits or duplicate action controls; desktop still works.

## Phase 6 — release verification
- [ ] Run and inspect exact-HEAD browser bridge, Android APK probe, XP painting, event Marshal, source integrity, archive, editor-save and document export suites.
- [ ] Report APK workflow, artifact ID/url/ZIP sha256 and source head.
- [ ] Document **deferred** physical Android and KVM testing; do not mark it passed based on emulation build alone.
**Acceptance:** passing required automation plus available external experimental installable ARM64 build. Physical UI acceptance remains separately required.

## Design decisions
- Preserve the existing React shell and source-backed native project services; refine rather than rewrite navigation.
- Bottom navigation is reserved for functional section destinations; Save/Export and canvas actions belong to contextual commands.
- Do not automatically discard edits on section switching. Real project root changes are exclusively controlled by the established guard.
- Use existing CI workflows; do not add paid test or binary storage infrastructure.

## Next concrete work
Reverify newest exact-HEAD workflow evidence after the Chromium disclosure-journey and JSDOM pointer-coordinate fixes. Continue map gesture/tool/palette integration, keyboard-safe panels, then sprite editor.

## Structural redesign verified checkpoint — 17 November 2026

- [x] Eliminate redundant loaded-project/title chrome and permanent receipt-height tax on narrow viewports.
- [x] Browser-verify full-width mobile PBS entity form, category switching and searchable record drawer, retaining pending edits.
- [x] Make Database and Ruby records/script lists on-demand, with desktop editors unchanged.
- [x] Compress project list navigation and sprite tools; make bottom Sprites tab open actual editor in one tap.
- [x] CI real Chromium UI/Rust ZIP roundtrip success at `790caaff`, evidence artifact `14256540030`.
- [ ] Verify exact *newer* HEAD CI and download corresponding ARM64 APK only from GitHub Actions.
- [ ] Improve map brush/palette discoverability and frame/zoom interaction on real large project layouts.
- [ ] Physical Android touch/SAF install/rotation acceptance remains deferred by user. Never represent emulator status as physical acceptance.
