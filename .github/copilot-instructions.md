# Essentials Studio Mobile — current coding priority (4 November 2026)

Deliver a usable Pokémon Essentials v21.1 / RPG Maker XP Android editor from the **existing working prototype and main branch**. Preserve work already done. Do not rewrite the editor.

## Priority order
1. Use the existing Android editor prototype and last integrated main. The repository has previously built an APK, and a KVM-backed Android emulator ran a synthetic import → tile edit → Save All → SAF export → ZIP-integrity test. Review current main before coding; older references to draft PR #12 or #48 in planning documents may be obsolete.
2. Finish the first real Shattered project loop: import an authorised Essentials v21.1 ZIP, show proper three-layer tiles and events, edit a tile and dialogue, Save All, close/reopen, export through Android SAF, independently verify unchanged ZIP members, reopen in desktop RMXP, and test edited gameplay in JoiPlay/NaviaXP. Record which steps have actual evidence and which remain blocked.
3. Functional defects take priority over optimisations or planning. Fix the next reproducible blocker in import, asset rendering, touch editing, event mutation, persistence, SAF export, or full re-import. Prefer producing a single integrated testable APK rather than opening more preliminary PRs.
4. Reuse existing green CI, Android KVM test workflow, ZIP verifier and physical-phone prototype evidence. Avoid repeating failed emulator/Wine setup. Run focused tests first and one integrated Android build per viable candidate. Keep existing protection against archive corruption and data loss.
5. Each work session should produce a meaningful code fix, integrated candidate or executed test. A read-only status report is not progress. If blocked by inaccessible files or runtime, record an exact reproducible error and advance a different source-level task. Do not create meaningless commits or invent completion claims.

## Hard requirements
Preserve original authorised project and byte-identical untouched archive members, including Ruby Marshal map layers, events, scripts, graphics, unknown metadata and PBS text. Keep commercial assets out of public GitHub. Treat synthetic CI, Android emulator, physical phone, desktop reopen and game playtests as separate gates. Preserve existing review, licensing, permissions and test checks; do not auto-merge unvalidated code. No paid overages, no unrelated repository edits.

Read `docs/SHATTERED_REAL_PROJECT_ANDROID_GATE.md`, `docs/ANDROID_PORT_PLAN.md` and `development/queue.json`, but prioritise live main, code and reproducible acceptance evidence over stale queue percentages or old draft-PR references.
