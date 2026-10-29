# Autonomous coding queue: GitHub Copilot cloud-agent dispatch

The watchdog checks the durable queue every **five minutes**, on new main commits and after selected CI runs. The existing watchdog only reported eligible tasks. The cloud dispatch module can now start actual **GitHub Copilot cloud-agent coding sessions** with PR output, once configured. It does not require GitHub Issues.

## One-time setup

1. Confirm that your GitHub account has a paid Copilot plan with cloud agent / agent tasks API access and that the cloud agent is enabled in this repository.
2. In GitHub, create a fine-grained personal access token restricted to repository xbaconator9000x/Essentials-Studio-Mobile. Grant **Agent tasks: Read and write**. Do not paste the token in chat or commit it to source.
3. In the repository go to **Settings -> Secrets and variables -> Actions -> New repository secret**, name it exactly **COPILOT_AGENT_TOKEN**, and paste the token as its value. This is a user credential (not the built-in GitHub Actions GITHUB_TOKEN).
4. Run **Actions -> Development queue watchdog -> Run workflow**. Confirm its summary says **Started Copilot cloud agent** and the repository gains a Copilot task and, once implemented, a reviewable PR.
5. Leave automated merges disabled. Review code, tests, real Essentials v21.1 project fidelity, and Android device results before approving task acceptance.

Official API documentation: https://docs.github.com/en/rest/agent-tasks/agent-tasks

## Execution rules

- Up to **two** concurrent Copilot sessions across independent areas, respecting max_parallel_native_workstreams from development/queue.json (currently **one** native/build/storage/editor/runtime session).
- Prioritizes eligible high-priority in-progress work and unblocked todo work with completed dependencies.
- Does not dispatch when an open PR already mentions its ASM task identifier.
- Saves a durable task reservation to **development/copilot-dispatch-state.json on main before** API launch, then saves the returned task ID. A crash or failed API call leaves a reservation instead of charging for duplicate sessions.
- Polls previously dispatched task IDs to release execution slots after Copilot completes or fails. **A completed agent task is not an accepted queue task.** Its receipt remains to prevent duplicate work.
- If no COPILOT_AGENT_TOKEN is configured, the watchdog still checks queue/tests and explicitly reports that actual coding execution is not configured.
- Never auto-merges, auto-completes acceptance, fabricates device tests, publishes binaries or bypasses the upstream licensing gate.
- PR CI exercises the queue selection, deduplication, reservation and credential-fallback policy.

## Recovery and limits

- GitHub Copilot sessions are external, and GitHub Actions schedules may run late. The script cannot guarantee nonstop execution or a particular frequency of code commits.
- If a task is stuck reserved because the agent creation request failed, **check Copilot tasks and the Actions log first**. Reconcile or remove only that record from development/copilot-dispatch-state.json through a reviewed GitHub change once duplicate creation is ruled out. Do not blindly delete records.
- If Copilot finishes but acceptance is not met, review its PR and ask for revisions. The task remains in_progress until code, tests and required evidence are verified.
- The upstream repository's licensing and physical Android project import/export still need independent validation. A green synthetic test suite does not close those gates.
- For failed API authentication, check the token permissions, cloud-agent entitlement and repository access. A regular GITHUB_TOKEN or GitHub App installation token cannot start these sessions.
