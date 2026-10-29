// Durable, opt-in GitHub Copilot cloud-agent dispatcher for the Essentials Studio queue.
// Requires a user-to-server token with "Agent tasks: read/write" repository permission.
// A normal Actions GITHUB_TOKEN cannot start Copilot agent sessions.
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const queuePath = resolve(root, "development/queue.json");
const statePath = "development/copilot-dispatch-state.json";
const activeStates = new Set(["reserved", "queued", "in_progress", "idle", "waiting_for_user"]);
const nativeAreas = new Set(["build", "native", "storage", "editor", "runtime"]);
const marker = id => "[EssentialsStudio:" + id + "]";

function recordFor(state, id) {
  return state.dispatches.find(item => item.task_id === id);
}

export function selectTasks(queue, state, openPrs, limit = 2) {
  const byId = new Map(queue.tasks.map(task => [task.id, task]));
  const dispatched = state.dispatches || [];
  const active = dispatched.filter(item => activeStates.has(item.agent_state || item.state));
  const available = Math.max(0, limit - active.length);
  const nativeLimit = queue.policy?.max_parallel_native_workstreams ?? 1;
  let nativeActive = active.filter(item => nativeAreas.has(byId.get(item.task_id)?.area)).length;
  let candidates = queue.tasks.filter(task => {
    if (task.status !== "in_progress" && task.status !== "todo") return false;
    if (task.depends_on.some(id => byId.get(id)?.status !== "done")) return false;
    // Any receipt is durable until explicitly cleared by a reviewer. Never retry blindly.
    if (recordFor(state, task.id)) return false;
    // Respect existing drafts (e.g. ASM-005 is already covered by PR #12).
    const re = new RegExp("(^|[^A-Z0-9])" + task.id + "([^0-9]|$)", "i");
    if (openPrs.some(pr => re.test((pr.title || "") + "\n" + (pr.body || "")))) return false;
    return true;
  }).sort((a, b) => a.priority - b.priority
    || Number(b.status === "in_progress") - Number(a.status === "in_progress")
    || a.id.localeCompare(b.id));
  const selected = [];
  for (const task of candidates) {
    if (selected.length >= available) break;
    if (nativeAreas.has(task.area)) {
      if (nativeActive >= nativeLimit) continue;
      nativeActive++;
    }
    selected.push(task);
  }
  return selected;
}

export function buildPrompt(task, queue) {
  return [
    marker(task.id) + " " + task.title,
    "Repository: xbaconator9000x/Essentials-Studio-Mobile. Base branch: main.",
    "This is REAL implementation work in the Android port of RPG Maker XP / Pokemon Essentials Studio.",
    "Read development/queue.json, current main, existing implementation, open PRs and tests first.",
    "Implement the largest SAFE coherent batch for task " + task.id + "; reuse upstream code and existing Android modules, not stubs.",
    "Keep the original XP .rxdata, scripts, event commands, PBS and assets intact unless edits are explicit.",
    "Create or update tests and document precisely what passed. No unverified real-device, licensing or v21.1 fidelity claims.",
    "Do not merge automatically. Open a reviewable PR naming " + task.id + " and leave queue acceptance pending for any unverified criterion.",
    "Do not store conversations, secrets, keys, tokens, credentials or personal data in the repository.",
    "Task area: " + task.area + ".",
    "Acceptance criteria:",
    ...task.acceptance.map((criterion, i) => String(i + 1) + ". " + criterion),
    "Blocking dependencies: " + (task.depends_on.join(", ") || "none") + ".",
    "Goal: tangible tested code, not task summaries or a fabricated completion percentage."
  ].join("\n");
}

function note(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, "\n" + message + "\n", "utf8");
  }
}

async function api(path, token, options = {}) {
  if (!token) throw new Error("Missing GitHub API token");
  const response = await fetch("https://api.github.com" + path, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Essentials-Studio-queue-dispatch",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const error = new Error("GitHub API " + response.status + " " + path + ": " + detail);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? {} : response.json();
}

async function loadState(repo, token) {
  try {
    const file = await api("/repos/" + repo + "/contents/" + statePath + "?ref=main", token);
    const text = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
    const state = JSON.parse(text);
    if (state.schema_version !== 1 || !Array.isArray(state.dispatches)) throw new Error("Invalid dispatch state");
    return { state, sha: file.sha };
  } catch (error) {
    if (error.status === 404) return { state: { schema_version: 1, dispatches: [] }, sha: null };
    throw error;
  }
}

async function saveState(repo, token, state, sha) {
  const body = {
    message: "chore(queue): checkpoint cloud-agent dispatch receipts [skip ci]",
    content: Buffer.from(JSON.stringify(state, null, 2) + "\n").toString("base64"),
    branch: "main"
  };
  if (sha) body.sha = sha;
  const response = await api("/repos/" + repo + "/contents/" + statePath, token, { method: "PUT", body });
  return response.content.sha;
}

async function allOpenPrs(repo, token) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api("/repos/" + repo + "/pulls?state=open&per_page=100&page=" + page, token);
    if (!Array.isArray(batch)) throw new Error("Invalid GitHub pull request response");
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error("More than 1000 open PRs; refusing to dispatch without complete duplicate check");
}

export async function dispatch(env = process.env) {
  const queue = JSON.parse(readFileSync(queuePath, "utf8"));
  const repo = env.GITHUB_REPOSITORY || "xbaconator9000x/Essentials-Studio-Mobile";
  if (repo !== "xbaconator9000x/Essentials-Studio-Mobile") {
    throw new Error("Refusing to dispatch against an unexpected repository: " + repo);
  }
  if (!env.COPILOT_AGENT_TOKEN) {
    note("**Cloud coding dispatch not configured:** add the repository Actions secret COPILOT_AGENT_TOKEN (user-to-server token, Agent tasks read/write, and a supported GitHub Copilot subscription). Existing scheduled queue checks remain read-only.");
    return { configured: false, started: [] };
  }
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN required for PR deduplication and durable receipt writes");
  }
  const { state, sha: initialSha } = await loadState(repo, env.GITHUB_TOKEN);
  let sha = initialSha;
  let stateChanged = false;
  // Recover remote state for every dispatched task. A finished agent session never
  // implies acceptance: its receipt stays until reviewed/cleared explicitly.
  for (const item of state.dispatches) {
    if (!item.agent_task_id) continue;
    const remote = await api("/agents/repos/" + repo + "/tasks/" + encodeURIComponent(item.agent_task_id), env.COPILOT_AGENT_TOKEN);
    if (remote.state !== item.agent_state) {
      item.agent_state = remote.state;
      item.task_url = remote.html_url || item.task_url;
      stateChanged = true;
    }
  }
  if (stateChanged) sha = await saveState(repo, env.GITHUB_TOKEN, state, sha);

  const prs = await allOpenPrs(repo, env.GITHUB_TOKEN);
  const chosen = selectTasks(queue, state, prs);
  if (chosen.length === 0) {
    note("**Cloud coding dispatch:** no unused eligible slot. Existing agent receipts, open PRs, task dependencies and native-workstream limit were respected.");
    return { configured: true, started: [] };
  }
  const started = [];
  for (const task of chosen) {
    // Reserve on GitHub BEFORE contacting the Copilot API. If creation fails or
    // the runner dies, the reservation prevents duplicate paid agent sessions.
    const receipt = {
      task_id: task.id, area: task.area, state: "reserved",
      reserved_at: new Date().toISOString(), agent_task_id: null
    };
    state.dispatches.push(receipt);
    sha = await saveState(repo, env.GITHUB_TOKEN, state, sha);
    try {
      const remote = await api("/agents/repos/" + repo + "/tasks", env.COPILOT_AGENT_TOKEN, {
        method: "POST",
        body: { prompt: buildPrompt(task, queue), base_ref: "main", create_pull_request: true }
      });
      if (!remote.id) throw new Error("Copilot API returned no task ID; reservation held for manual reconciliation");
      receipt.agent_task_id = remote.id;
      receipt.agent_state = remote.state || "queued";
      receipt.state = "dispatched";
      receipt.task_url = remote.html_url || null;
      sha = await saveState(repo, env.GITHUB_TOKEN, state, sha);
      started.push(task.id);
      note("**Started Copilot cloud agent:** " + task.id + " — " + (receipt.task_url || remote.id));
    } catch (error) {
      note("**Dispatch blocked:** " + task.id + " reservation retained to prevent duplicate billing. Inspect GitHub Actions and reconcile development/copilot-dispatch-state.json. " + error.message);
      throw error;
    }
  }
  return { configured: true, started };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dispatch().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
