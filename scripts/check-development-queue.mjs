import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const queue = JSON.parse(readFileSync(resolve(root, "development/queue.json"), "utf8"));
const statuses = new Set(["todo", "in_progress", "blocked", "done"]);
const requiredFields = ["id", "title", "area", "status", "priority", "depends_on", "acceptance", "evidence"];

function check(condition, message) {
  if (!condition) throw new Error(`Development queue: ${message}`);
}

check(queue.schema_version === 1, "unsupported schema version");
check(Array.isArray(queue.tasks) && queue.tasks.length > 0, "tasks required");
const ids = new Set();
for (const task of queue.tasks) {
  for (const field of requiredFields) check(Object.hasOwn(task, field), `${task.id ?? "unknown"} missing ${field}`);
  check(typeof task.id === "string" && /^ASM-\d{3}$/.test(task.id), "invalid task ID");
  check(!ids.has(task.id), `duplicate task ${task.id}`);
  ids.add(task.id);
  check(statuses.has(task.status), `${task.id} invalid status`);
  check(Number.isSafeInteger(task.priority) && task.priority >= 0, `${task.id} invalid priority`);
  check(Array.isArray(task.depends_on) && Array.isArray(task.acceptance) && Array.isArray(task.evidence), `${task.id} invalid arrays`);
  check(task.acceptance.length > 0, `${task.id} missing acceptance criteria`);
  check(task.status !== "done" || task.evidence.length > 0, `${task.id} marked done without evidence`);
  check(task.status !== "blocked" || (typeof task.blocker === "string" && task.blocker.length > 0), `${task.id} blocked without explanation`);
}
for (const task of queue.tasks) {
  check(new Set(task.depends_on).size === task.depends_on.length, `${task.id} duplicate dependency`);
  for (const dependency of task.depends_on) check(ids.has(dependency) && dependency !== task.id, `${task.id} missing or self dependency ${dependency}`);
}
const tasks = new Map(queue.tasks.map(t => [t.id, t]));
const visited = new Set();
const active = new Set();
function walk(id) {
  if (active.has(id)) throw new Error(`Development queue: dependency cycle at ${id}`);
  if (visited.has(id)) return;
  active.add(id);
  for (const dep of tasks.get(id).depends_on) walk(dep);
  active.delete(id);
  visited.add(id);
}
for (const id of ids) walk(id);

const done = queue.tasks.filter(t => t.status === "done").length;
const eligible = queue.tasks.filter(t => t.status === "todo" && t.depends_on.every(id => tasks.get(id).status === "done"));
console.log(`Android queue valid: ${queue.tasks.length} tasks, ${done} completed, ${eligible.length} eligible todo tasks`);
for (const task of eligible.sort((a, b) => a.priority - b.priority)) console.log(`  ${task.id} [P${task.priority}] ${task.title}`);
