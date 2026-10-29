import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const queue = JSON.parse(readFileSync(resolve(root, "development/queue.json"), "utf8"));
const tasks = new Map(queue.tasks.map(t => [t.id, t]));
const eligible = queue.tasks
  .filter(t => t.status === "todo" && t.depends_on.every(id => tasks.get(id)?.status === "done"))
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
// List once so duplicate labels/titles across watchdog runs don't create duplicate issues.
const existing = JSON.parse(runGh("issue", "list", "--state", "all", "--limit", "500", "--json", "title,number"));
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
