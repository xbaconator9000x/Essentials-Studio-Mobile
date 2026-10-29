import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// This is a deliberately read-only GitHub queue handoff. GitHub Actions does
// not initiate a ChatGPT conversation or call any paid external AI API.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function summarizeQueue(queue) {
  const tasks = new Map(queue.tasks.map(task => [task.id, task]));
  const ordered = items => items.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return {
    total: queue.tasks.length,
    done: queue.tasks.filter(task => task.status === "done").length,
    active: ordered(queue.tasks.filter(task => task.status === "in_progress")),
    eligible: ordered(queue.tasks.filter(task =>
      task.status === "todo" && task.depends_on.every(id => tasks.get(id)?.status === "done"))),
    blocked: ordered(queue.tasks.filter(task => task.status === "blocked")),
  };
}

export function renderHandoff(summary) {
  const lines = [
    "### Essentials Studio Mobile — ChatGPT coding handoff",
    "",
    "GitHub performs free queue validation, CI tests and APK builds. The already configured ChatGPT watchdog is the coding agent; this workflow cannot wake ChatGPT or perform autonomous AI coding.",
    "",
    "#### Active workstreams (continue before starting duplicates)",
    "",
  ];
  if (summary.active.length === 0) lines.push("No task is currently marked in progress.");
  for (const task of summary.active) {
    lines.push("- **" + task.id + "** [P" + task.priority + "] " + task.title);
    lines.push("  - Existing work: inspect open pull requests and latest main before editing");
    for (const criterion of task.acceptance) lines.push("  - [ ] " + criterion);
  }
  lines.push("", "#### Next dependency-ready tasks", "");
  if (!summary.eligible.length) lines.push("None currently; continue active work or investigate blocked dependencies.");
  for (const task of summary.eligible) {
    lines.push("- **" + task.id + "** [P" + task.priority + "] " + task.title);
    lines.push("  - Depends on: " + (task.depends_on.join(", ") || "none"));
    for (const criterion of task.acceptance) lines.push("  - [ ] " + criterion);
  }
  lines.push("", "#### Blockers", "");
  if (!summary.blocked.length) lines.push("No explicitly blocked tasks.");
  for (const task of summary.blocked) {
    lines.push("- **" + task.id + "** " + task.title + ": " + (task.blocker || "Unspecified blocker"));
  }
  lines.push("",
    "#### Implementation rules",
    "",
    "- Only the existing ChatGPT automation or an authorised developer may edit source. GitHub Actions does not dispatch to Copilot, Jules, Work, or an AI API.",
    "- Work through independent eligible tasks in substantial batches, avoid overlapping open PRs, and preserve original RPG Maker XP, event, Ruby Marshal and PBS data.",
    "- Record actual commits and test evidence in development/queue.json. Do not mark a task done on a mere compile, synthetic test, or handoff.",
    "- Continue non-conflicting work while affected CI checks run; never merge unverified changes or claim on-device validation without evidence.",
    "",
    "**No Copilot Pro, ChatGPT Work, paid token, external AI API key or GitHub Issues are required to run this queue.**",
    "",
  );
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const queue = JSON.parse(readFileSync(resolve(root, "development/queue.json"), "utf8"));
  const summary = summarizeQueue(queue);
  console.log(JSON.stringify({
    total: summary.total,
    done: summary.done,
    in_progress: summary.active.map(task => task.id),
    eligible: summary.eligible.map(task => task.id),
    blocked: summary.blocked.map(task => task.id),
  }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderHandoff(summary), "utf8");
  }
}
