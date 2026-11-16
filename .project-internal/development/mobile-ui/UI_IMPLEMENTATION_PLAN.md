# Mobile UI implementation plan

**Status as of 16 November 2026:** Active, phase 1 in progress. The real branch and CI are authoritative; see [CONTINUATION_STATE.md](CONTINUATION_STATE.md) for checkpoint.

## Phase 1 — shell, wayfinding and workspace
- [x] Existing baseline provides bottom Projects/Maps/Sprites/Settings navigation, map-organisation/view-edit controls, Save/Export command strip and preserved map-tree state.
- [ ] Simplify portrait chrome while keeping Save/Export visible and distinguish map versus project actions.
- [ ] Make contextual transitions clear, accessible, non-destructive and independent of project save state.
- [ ] Prioritise map canvas height with compact collapsible controls, landscape responsiveness, safe-area padding and keyboard-safe overlays.
- [ ] Regression tests for all visible destinations, dirty-state continuity, busy behaviour and phone-width layouts.
**Acceptance:** project opens; map selection enters editor; browser/Android Back and tab switching preserve unsaved map edits; Save All/ZIP work; controls and map fit portrait; desktop unchanged.

## Phase 2 — maps and tilesets
- [ ] Validate painting vs pinch/pan gesture arbitration with tests.
- [ ] Brush/erase/fill/selection discoverability, layer and visibility status, active tools and undo/redo.
- [ ] Collapsible tileset panel, scroll/selection/autotiles/recent tile shortcuts.
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
Finish phase 1 command/navigation density and phone keyboard/safe-area experience, with regression tests; then map/tileset workflow.
