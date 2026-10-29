import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const queue = JSON.parse(readFileSync(resolve(root, "development/queue.json"), "utf8"));
const tasks = new Map(queue.tasks.map(t => [t.id, t]));
const eligible = queue.tasks
  .filter(t => t.status === "todo" && t.depends_on.every(id => tasks.get(id)?.status === "done"))
  .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
const active = queue.tasks
  .filter(t => t.status === "in_progress")
  .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
const blocked = queue.tasks.filter(t => t.status === "blocked");
const summary = {
  total: queue.tasks.length,
  done: queue.tasks.filter(t => t.status === "done").length,
  in_progress: queue.tasks.filter(t => t.status === "in_progress").map(t => t.id),
  blocked: blocked.map(t => ({ id: t.id, blocker: t.blocker })),
  eligible: eligible.map(t => ({ id: t.id, title: t.title, priority: t.priority, acceptance: t.acceptance })),
};
console.log(JSON.stringify(summary, null, 2));

if (!process.argv.includes("--create-issues")) process.exit(0);
if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN or GH_TOKEN is required for automatic issue creation");
}
const repo = process.env.GITHUB_REPOSITORY || "xbaconator9000x/Essentials-Studio-Mobile";
const runGh = (...args) => {
  const result = spawnSync("gh", [...args, "--repo", repo], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`gh ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
};
// Issue tracking is optional: this public repository currently has Issues disabled.
// Always publish an actionable handoff in the run summary so the scheduled check
// succeeds and an implementation agent can pick up work from queue.json.
function appendHandoffSummary(note) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    "### Next eligible Essentials Studio Mobile work",
    "",
    note,
    "",
    ...eligible.flatMap(task => [
      "- **" + task.id + "** [P" + task.priority + "] " + task.title,
      "  - Depends on: " + (task.depends_on.join(", ") || "nothing"),
      ...task.acceptance.map(criterion => "  - [ ] " + criterion),
    ]),
    ...(eligible.length === 0 ? [
      "No new todo task is eligible. Continue the in-progress workstreams below; a pending acceptance gate is not a completed task.",
      "",
      "#### In-progress implementation streams",
      "",
      ...active.flatMap(task => [
        "- **" + task.id + "** [P" + task.priority + "] " + task.title,
        "  - Remaining acceptance:",
        ...task.acceptance.map(criterion => "    - [ ] " + criterion),
      ]),
      ...(active.length === 0 ? ["No active streams; inspect blockers and task dependencies."] : []),
    ] : []),
    "",
    "Only actual code/test results can advance task states. This workflow is a handoff, not a coding agent.",
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", "utf8");
}
let existing;
try {
  existing = JSON.parse(runGh("issue", "list", "--state", "all", "--limit", "500", "--json", "title,number"));
} catch (error) {
  if (/has disabled issues|issues (?:are|is) disabled/i.test(String(error))) {
    console.warn("Repository issues are disabled; handoff recorded in Actions summary instead.");
    appendHandoffSummary("GitHub Issues are disabled for this repository. Work remains queued in development/queue.json.");
    process.exit(0);
  }
  throw error;
}
appendHandoffSummary("Eligible tasks are also tracked as deduplicated GitHub Issues.");
for (const task of eligible) {
  if (existing.some(issue => issue.title.startsWith(`${task.id}:`))) continue;
  const body = [
    "Automatically surfaced from the durable development queue.",
    "",
    `Task: **${task.id}** — ${task.title}`,
    `Priority: ${task.priority}`,
    `Dependencies: ${task.depends_on.length ? task.depends_on.join(", ") : "none"}`,
    "",
    "### Required acceptance criteria",
    ...task.acceptance.map(x => `- [ ] ${x}`),
    "",
    "### Implementation handoff",
    "Read current main and open PRs first. Implement real code and verify tests on a development branch.",
    "Update development/queue.json only with evidence. Do not auto-mark complete merely because this issue exists.",
    "No live source-code agent is installed in GitHub Actions; this issue is a queued handoff for connected coding agents.",
  ].join("\n");
  const issue = runGh("issue", "create", "--title", `${task.id}: ${task.title}`, "--body", body);
  console.log(`Queued ${task.id}: ${issue}`);
}
