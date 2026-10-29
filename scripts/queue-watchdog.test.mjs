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
    assert.match(handoff, /ASM-014/);
    assert.match(handoff, /Only actual code\/test results can advance task states/);
    assert.match(handoff, /development\/queue.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
