import test from "node:test";
import assert from "node:assert/strict";
import { selectTasks, buildPrompt, dispatch } from "./copilot-dispatch.mjs";

const task = (id, area, priority, status = "todo", depends_on = []) => ({
  id, title: "Implement " + id, area, priority, status, depends_on,
  acceptance: ["Working implementation", "Passing regression tests"]
});
const queue = tasks => ({
  tasks, policy: { max_parallel_native_workstreams: 1 }
});
const state = (...dispatches) => ({ schema_version: 1, dispatches });

test("dispatches independent work in parallel while limiting native work to one", () => {
  const q = queue([
    task("ASM-003", "native", 0, "in_progress"),
    task("ASM-004", "storage", 1, "in_progress"),
    task("ASM-014", "quality", 3, "in_progress")
  ]);
  assert.deepEqual(selectTasks(q, state(), [], 2).map(t => t.id), ["ASM-003", "ASM-014"]);
});

test("never dispatches blocked, completed or dependency-locked tasks", () => {
  const q = queue([
    task("ASM-001", "build", 0, "done"),
    task("ASM-002", "quality", 0, "blocked"),
    task("ASM-004", "storage", 1, "todo", ["ASM-003"]),
    task("ASM-010", "ui", 2, "todo", ["ASM-001"])
  ]);
  assert.deepEqual(selectTasks(q, state(), [], 2).map(t => t.id), ["ASM-010"]);
});

test("open draft PRs and durable receipts prevent duplicate agent sessions", () => {
  const q = queue([
    task("ASM-003", "native", 0, "in_progress"),
    task("ASM-005", "storage", 1, "in_progress"),
    task("ASM-014", "quality", 3, "in_progress")
  ]);
  const prs = [{ title: "Export Android files", body: "ASM-005 in progress" }];
  const receipts = state({ task_id: "ASM-003", area: "native", state: "dispatched", agent_state: "completed" });
  assert.deepEqual(selectTasks(q, receipts, prs, 2).map(t => t.id), ["ASM-014"]);
  assert.deepEqual(selectTasks(q, receipts, prs, 2).map(t => t.id), ["ASM-014"], "repeat selection must be stable");
});

test("a reservation prevents resubmission and occupies a slot", () => {
  const q = queue([
    task("ASM-003", "native", 0, "in_progress"),
    task("ASM-004", "storage", 1, "in_progress"),
    task("ASM-014", "quality", 2, "in_progress")
  ]);
  const receipts = state({ task_id: "ASM-003", area: "native", state: "reserved" });
  assert.deepEqual(selectTasks(q, receipts, [], 2).map(t => t.id), ["ASM-014"]);
  assert.deepEqual(selectTasks(q, receipts, [], 1).map(t => t.id), []);
});

test("a running native agent occupies the native lane but not the quality lane", () => {
  const q = queue([
    task("ASM-003", "native", 0, "in_progress"),
    task("ASM-004", "storage", 1, "in_progress"),
    task("ASM-014", "quality", 3, "in_progress")
  ]);
  const receipts = state({ task_id: "ASM-003", area: "native", state: "dispatched", agent_state: "in_progress" });
  assert.deepEqual(selectTasks(q, receipts, [], 2).map(t => t.id), ["ASM-014"]);
});

test("agent instructions preserve acceptance criteria and require review", () => {
  const q = queue([task("ASM-003", "native", 0)]);
  const prompt = buildPrompt(q.tasks[0], q);
  assert.match(prompt, /\[EssentialsStudio:ASM-003\]/);
  assert.match(prompt, /Working implementation/);
  assert.match(prompt, /Do not merge automatically/);
  assert.match(prompt, /not stubs/);
});

test("missing Copilot credentials fail closed without claiming code was dispatched", async () => {
  const result = await dispatch({
    GITHUB_REPOSITORY: "xbaconator9000x/Essentials-Studio-Mobile",
    GITHUB_TOKEN: "unused"
  });
  assert.deepEqual(result, { configured: false, started: [] });
});
