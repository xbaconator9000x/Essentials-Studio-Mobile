# Free cloud coding with Google Jules

The default cloud coder is Google Jules, **not paid Copilot**. Jules has a free hosted plan with 15 tasks per rolling 24-hour period and 3 concurrent tasks (subject to Google's changes). Jules runs in Google's cloud VM, not the user's device. Its alpha REST API supports automatically creating pull requests.

This repository reserves at most **three new Jules tasks per rolling 24 hours** and at most **two simultaneous task sessions**, with one native-editing workstream. This conservative allowance leaves room for the user's other repositories and manual Jules work, though the service's account-wide quota remains authoritative. Failed or interrupted sessions remain tracked for review; no infinite retry loops. Cloud AI can still make mistakes, and external capacity, latency and free-plan quotas are not guaranteed.

Official documentation:
- https://jules.google/docs/usage-limits
- https://jules.google/docs/api/reference
- https://jules.google/docs/api/reference/sessions

## One-time setup (user action required)

1. Visit https://jules.google/ and sign in to your Google account. **Do not buy a plan.**
2. Connect GitHub using the Jules GitHub App. Grant only the repository xbaconator9000x/Essentials-Studio-Mobile.
3. Go to https://jules.google.com/settings and generate a **Jules REST API key** (not a Gemini API or Google AI Studio key).
4. In the GitHub repository, go to Settings > Secrets and variables > Actions > New repository secret; set the name to **JULES_API_KEY** and paste its value. Never paste the key in chat, the repository, or a PR.
5. In Actions > Development queue watchdog, click Run workflow. The summary reports the queued task, Jules session identifier, or a configuration/permission error.

Paid Copilot is not invoked by default. It requires the explicit repository variable CODING_AGENT_PROVIDER=copilot, with a COPILOT_AGENT_TOKEN, **and no JULES_API_KEY**. To guarantee no paid Codex/Copilot runs, do not configure this variable or Copilot token.

## How the queue behaves

- Checks main, queue dependencies, current open PRs, durable Jules receipts and free-plan per-repo throttle.
- Before Jules is called, saves a durable task reservation to development/jules-dispatch-state.json on main.
- Uses Jules REST POST /v1alpha/sessions with sourceContext for the connected GitHub repository, startingBranch main, requirePlanApproval=false, and automationMode=AUTO_CREATE_PR.
- Polls the returned Jules session name on later workflow runs, recording session state and any PR link.
- A finished session never marks a task "done" merely because AI says it's complete. Real tests, human review, on-device verification and licence clearance remain separate acceptance gates.
- Reservations remain after errors, preventing duplicate Jules sessions from transient crashes. To release a reservation, first inspect Jules sessions and PRs and ensure no work was already started.
- The Jules API is experimental, so endpoint/schema changes may require updates.

## Cost and deployment notes

- Free Jules means no AI credit charges **within the free tier**. Tasks above the free service quota cannot be assumed to run; expect rate limiting rather than free infinite computation.
- Public GitHub hosted CI is separate from Jules. The current Android ARM64 build and regression tests still run on GitHub Actions.
- Never allow unattended agents to merge protected branches, publish unsigned binaries as releases, or handle credentials directly.
- Never grant remote agents access to signed application keys, secrets, or private personal files.

The four-project plan needs explicit per-repository rollout and quota coordination. This initial integration configures Essentials Studio Mobile only.
