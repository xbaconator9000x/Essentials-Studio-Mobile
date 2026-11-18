# Mobile UI testing, APK distribution and release policy

## Required regression gates

Run existing tests triggered by changes, then inspect **exact-HEAD** GitHub Actions workflow conclusions. Relevant suites: Browser-first native project bridge, Android APK probe, XP map painting fidelity, Event Marshal fidelity, Project ZIP source-integrity, Archive roundtrip, Editor save failure, Android document export handoff, image-load regressions and any applicable UI component tests. Assert real behaviour and data fidelity; do not weaken failures to manufacture green checks. Review failures, fix root cause and revalidate where practical. Do not rerun successfully passing jobs without need or introduce paid test providers.

Browser/unit/native roundtrip results must remain distinct from native Android emulator/KVM and physical touchscreen acceptance. Android emulator/KVM work is deferred and nonblocking; a green APK build does not establish operational portrait ergonomics or user acceptance. Do not fabricate screenshots, test results, metrics or checksums.

## Android build and artifact handling

- Keep an installable experimental **Android ARM64 APK** using the repository's existing Android build workflow.
- Default distribution = **GitHub Actions artifact** hosted externally, within existing free storage/retention limits.
- In every release-oriented report include exact commit SHA, GitHub Actions run ID/URL, workflow status, artifact ID/name/download URL, GitHub-reported artifact ZIP SHA-256 and whether the artifact matches **current live HEAD**. If unverified, say so.
- Older APKs must be explicitly labelled earlier-HEAD builds, not presented as containing new patches. Expired artifacts must be marked expired; rebuild using existing infrastructure only when appropriate.
- Do **not** upload APKs, binary ZIPs, intermediate Android builds or generated binaries to ChatGPT/ChatGPT Library; reserve Library for necessary source/reference material. Never commit compiled binaries to source to make them downloadable.
- Do not upload project ZIPs, original ROMs, save files, private Shattered assets, signing credentials, certificates or proprietary material to public GitHub/CI artifacts. Keep signing private and retain the expected package signing identity when distributing replaceable builds.
- GitHub Releases or an appropriate free alternative can be evaluated if Actions artifacts become unsuitable. **Never label an experimental build stable or publish a stable release without explicit authorisation.**

## Acceptance evidence

For each substantive batch: describe changed production paths, tests added, exact commits, passing/failing/in-progress workflows, test counts when verifiable, and any regression or coordination hazard. Link official GitHub evidence. Note constraints on portrait/landscape desktop behavior, RMXP/Pokémon Essentials 21.1, event Marshal, Save All and ZIP source integrity. Keep manual Android phone test checklist separate from automated status; never mark deferred manual/KVM checks passed.

## Repository hygiene

`.project-internal/development/mobile-ui/` is a **dot-prefixed but public** directory: do not store secrets or private user data. Documentation is source-only and must not be pulled into Android APK or project import/export bundles. Update continuation state on meaningful milestones; live source and exact-HEAD CI win over stale documentation.
