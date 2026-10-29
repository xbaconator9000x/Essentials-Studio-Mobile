import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("disabled GitHub Issues hand off eligible queue work without failing CI", () => {
  const dir = mkdtempSync(join(tmpdir(), "essentials-queue-"));
  try {
    const gh = join(dir, "gh");
    const summary = join(dir, "summary.md");
    writeFileSync(gh, '#!/bin/sh\necho "the repository has disabled issues" >&2\nexit 1\n', { mode: 0o755 });
    const result = spawnSync(process.execPath, ["scripts/queue-watchdog.mjs", "--create-issues"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GH_TOKEN: "test-token",
        GITHUB_REPOSITORY: "xbaconator9000x/Essentials-Studio-Mobile",
        GITHUB_STEP_SUMMARY: summary,
        PATH: dir + ":" + process.env.PATH,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /issues are disabled/i);
    const handoff = readFileSync(summary, "utf8");
    const queue = JSON.parse(readFileSync(join(root, "development/queue.json"), "utf8"));
    const byId = new Map(queue.tasks.map(task => [task.id, task]));
    const eligible = queue.tasks.filter(task => task.status === "todo"
      && task.depends_on.every(id => byId.get(id)?.status === "done"));
    const expected = eligible.length > 0
      ? eligible
      : queue.tasks.filter(task => task.status === "in_progress");
    for (const task of expected) {
      assert.ok(handoff.includes(task.id), `handoff omitted active task ${task.id}`);
    }
    if (eligible.length === 0) {
      assert.match(handoff, /In-progress implementation streams/);
    }
    assert.match(handoff, /Only actual code\/test results can advance task states/);
    assert.match(handoff, /development\/queue.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
