# Android editor: next integrated delivery batch

Follow-up to merged PR #96. This document records the user-approved large cohesive Copilot Pro implementation assignment, not evidence of completed work.

## Delivery scope

1. Validate Android SAF import of an authorised real Essentials v21.1 project ZIP where available; use rights-cleared representative fixtures in public CI, never proprietary Shattered assets. Diagnose/fix any Ruby Marshal, metadata, map, event, or graphics compatibility failures without destroying opaque project data.
2. End-to-end import → three-layer map, events and character graphics → touch tile and dialogue edit → Save All → close/reopen → SAF ZIP export/readback → reimport. Preserve unknown project entries and untouched archive bytes.
3. Fix map-edge rendering and missing adjacent tiles, map/event/character sprite loading, and mobile touch editing defects encountered in real UI.
4. Build a practical mobile sprite editor: collapsible tool and palette panels, touch zoom/pan, project sprite picker, edit-original versus edit-copy workflow, trace overlay with opacity/scale, export/save and reopen, and hide/show map pins.
5. Run functional Android KVM emulator evidence on the current PR head, inspect screenshots/hierarchy/logs, fix failures in the same PR, and produce APK artifact/hash. Keep synthetic emulator validation distinct from authorised real-project and physical-device acceptance.

## Delivery constraints

One PR, sequential cohesive commits, no microtask split, no paid overages or paid APIs, no unrelated repos, no proprietary assets in public CI. Report specific tests, evidence, defects, remaining gates; do not claim a green test for cancelled workflows.
