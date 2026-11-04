# Essentials Studio Mobile — Copilot Pro delivery lane (4 November 2026)

## Current architecture and actual activation

**Goal: working APK for the genuine authorised Pokémon Essentials v21.1 project, urgently.** GitHub is source-of-truth for code, queue, PRs, build artifacts and tests. GitHub Actions runs the queue validator and CI; **Actions queue checks do not launch AI coding automatically**. The ChatGPT hourly **Essentials Studio Mobile watchdog** acts as supervisor: inspect actual implementation PRs/CI, send a new, nonoverlapping **`@copilot` PR comment** requesting the next implementable functional task when prior work has demonstrably finished, verify changes and report only evidenced progress. GitHub's Copilot Pro cloud agent performs implementation in the PR branch when an eligible comment actually starts its session.

**Issue creation / direct issue assignment is NOT available at present:** repository Issues are disabled. Use the existing open delivery PR **`copilot/mobile-delivery-20261104`** (created to establish this lane). If Issues are later enabled, assign one targeted issue to Copilot and verify that GitHub actually starts its agent before replacing the PR-comment path. Do not silently pretend a queue row, `@copilot` mention, or completed ChatGPT scheduled task constitutes successful agent dispatch: verify visible Copilot session or source commits.

No external API key or `COPILOT_AGENT_TOKEN` is configured by this document. The removed PR #23 direct API dispatcher is **not** re-enabled. This path uses GitHub's existing supported `@copilot` PR comments instead, subject to the user's Copilot Pro eligibility and actual agent response. Never purchase premium requests or incur paid overages; do not flood mentions or create duplicate work sessions. Check subscription/usage if available; otherwise report that usage is unverified.

## Priorities (outcome-based)

1. **Complete existing app, do not rebuild it.** Work from the current Tauri/React/Rust source, Android debug APK and previously successful KVM Android emulator synthetic ZIP import → tile edit → Save All → SAF export/re-import. Do not redo known infrastructure.
2. **Deliver a real-project editing loop:** import the authorised Shattered Essentials v21.1 ZIP, render the real three-layer map, event commands and art, edit tile *and* event dialogue, save, close/reopen, SAF export, re-import, verify untouched ZIP members and test desktop RMXP compatibility. Record real runtime/Android/device gates separately from synthetic/CI.
3. The most valuable next source bug in import, character/tileset rendering, event edit persistence, save/export or Android touch workflow should be **implemented in each Copilot coding assignment**. Tests should be narrowly focused; run one candidate APK integration check per viable source batch. No repeated full test suite when source hasn't changed.
4. If a real private Shattered archive is absent from Copilot's GitHub cloud environment, its licensed data must NOT be uploaded into this public repository. Continue with an independently demonstrable source fix or produce a precise blocker; don't claim successful private-project acceptance.
5. Preserve source copyrights, project bytes, Ruby Marshal/PBS roundtrip and required reviews. No auto-merge absent real validation and permissions.

## Supervisor/agent handoff contract

- Inspect the active PR discussion and fresh commits; confirm whether Copilot accepted or finished the previous request. A posted comment alone is **not proof of a running agent**.
- Allow **one active Copilot delivery assignment per repository** until that session is confirmed finished or blocked; do not send repeating `@copilot` messages just because an hourly check ran.
- When a previous assignment genuinely finishes, review changed files/checks. Request a targeted fix in the same PR or issue a **new, concrete code-changing** task from `development/queue.json`, focused on the shortest path to an APK.
- If GitHub prevents activation, log the exact status and notify the user. Don't switch back to fake hourly “engineering” reports, spam new PRs, or silently spend ChatGPT credits doing repetitive audits.
- Each hourly report: verified Copilot session/PR (or not verified), code SHA, source changes, CI/runtime/Android evidence, next actual deliverable, one real blocker, any needed human action. Work on ONE integrated functional lane, not documentation or speculative refactoring.

The prior ChatGPT-first/no-Copilot document was historically accurate after PR #30 removed the token-based Copilot dispatcher on 29 October, but is superseded by this 4 November user instruction to use their existing Copilot Pro subscription. **This file alone does not prove a working Copilot assignment; the PR comment and ensuing GitHub agent activity are the necessary confirmation.**
