# Essentials Studio Mobile Copilot instructions

This is the **Android Tauri/Rust/React editor for RPG Maker XP / Pokémon Essentials v21.1**, not an RPG engine and not the original Pokémon Shattered ROM hack. Read `docs/ANDROID_PORT_PLAN.md`, `docs/SHATTERED_REAL_PROJECT_ANDROID_GATE.md`, and `development/queue.json` first.

**Goal:** a real imported Shattered Essentials game ZIP can be edited on Android without corrupting XP Ruby Marshal maps/scripts, Pokémon Essentials PBS text, or unmodified assets; then safely exported as a ZIP that desktop/RMXP tooling can reopen. The *game runtime itself* remains separate.

- **Treat real v21.1 import/edit/export/reopen as the bottleneck.** Implement and test missing functionality; do not spend premium coding sessions on generic audits or docs alone.
- Existing draft **PR #12 owns Android SAF export**. Do not implement a competing SAF path; finish it there or wait for merge. Use actual newest `main` when reconciling.
- Keep source game/project archives, Pokémon art, licensed RMXP assets, credentials and private keys out of public commits. Generate tiny rights-cleared/fully synthetic XP Marshal fixtures for CI; never claim they prove full real-game compatibility.
- Respect Android scoped storage: `content://` URIs are document providers, not filesystem paths. Use app-private extraction, traversal/symlink/size checks and lossless unknown-field preservation.
- Preserve Ruby scripts, MapInfos, System, Tilesets, all three map layers, event pages and PBS original comments/newlines. Existing safety/QA tests are regression gates, not optional.
- Tests and acceptance evidence are required with every PR. Report unsupported operations, blocker reproductions and exact manual on-device test instructions; do not claim to have used a phone or desktop editor if not actually tested.
- Run focused Node/Rust suites before expensive Android compilation. Keep checks incremental, avoid duplicate Actions runs, do not enable any paid AI API or overage budget.
- Changes live on reviewable PR branches, do not auto-merge. Do not modify Shattered, XGBA, PokéBacon or paused PKHeX/CUBE repos as part of this assignment.

## Integration-first execution priority
Before adding feature PRs, reconcile the current SAF, event integrity, graphics, ZIP import and map editing drafts into one reviewable candidate using newest main. Inspect current heads and CI, run focused checks first, fix combined regressions and preserve existing review requirements.
The next acceptance milestone is one genuine authorised Shattered Essentials project: Android import → map/event edit → export through SAF → desktop reopen → changed event executes. Preserve all untouched archive members byte-for-byte. Synthetic fixtures and APK compilation remain distinct from this acceptance.
Produce one commit-specific candidate artifact and short manual test route after combined native/frontend checks pass; build Android once per validated candidate rather than per speculative change. Record project hash, candidate SHA and evidence for each acceptance step. Missing source inputs must be explicit blockers.
After completing a queue task select the next eligible integration task in the same execution while capacity remains. Hourly watchdog is recovery, not a reason to stop. Do not open duplicate implementations or spend sessions on repeated generic audits. Keep genuine device/runtime gates open until observed.


## Work runtime acceptance (user directive, 2026-10-30)
ChatGPT Work coordinates actual runtime testing. GitHub Actions supplies builds and supporting regression checks only; a green workflow never proves Android or gameplay acceptance. Continue develop → integrate → build → install → launch → test → repair → retest → commit while an executable path exists. Record features separately as implemented, integrated, runtime verified, or blocked, with exact candidate SHA/artifact hash and observed evidence. Assess Work runtime provisioning before assigning device work to the user. Preserve successful prototype implementations; integrate instead of rewriting. Runtime claims require actual execution, screenshots/logs and persisted-state checks; synthetic fixtures remain supporting evidence. On a genuine environment restriction, preserve the reproduction and continue independent eligible work rather than repeatedly re-auditing the same blocker.
