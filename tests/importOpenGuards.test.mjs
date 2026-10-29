import test from "node:test";
import assert from "node:assert/strict";
import { importAndOpenProject } from "../src/services/importOpenGuards.ts";

const file = { name: "project.zip" };

test("successful import and open never discard app-private project", async () => {
  const calls = [];
  await importAndOpenProject(file, {
    importArchive: async () => { calls.push("import"); return "/private/import-good"; },
    openProject: async () => { calls.push("open"); },
    discardFailedImport: async () => { calls.push("discard"); },
    isActiveProject: () => false,
  });
  assert.deepEqual(calls, ["import", "open"]);
});

test("invalid initial XP map discards only the rejected import", async () => {
  const calls = [];
  const error = new Error("invalid Map001.rxdata");
  await assert.rejects(importAndOpenProject(file, {
    importArchive: async () => "/private/import-bad",
    openProject: async () => { throw error; },
    discardFailedImport: async (path) => { calls.push(path); },
    isActiveProject: () => false,
  }), (actual) => actual === error);
  assert.deepEqual(calls, ["/private/import-bad"]);
});

test("failed ZIP upload has no published directory to discard", async () => {
  let discarded = false;
  await assert.rejects(importAndOpenProject(file, {
    importArchive: async () => { throw new Error("truncated ZIP"); },
    openProject: async () => { throw new Error("must not open"); },
    discardFailedImport: async () => { discarded = true; },
    isActiveProject: () => false,
  }), /truncated ZIP/);
  assert.equal(discarded, false);
});

test("failure after project became active never deletes it", async () => {
  let active = false;
  let discarded = false;
  await assert.rejects(importAndOpenProject(file, {
    importArchive: async () => "/private/import-active",
    openProject: async () => { active = true; throw new Error("late render failure"); },
    discardFailedImport: async () => { discarded = true; },
    isActiveProject: () => active,
  }), /late render failure/);
  assert.equal(discarded, false);
});

test("cleanup failures preserve both the import and cleanup errors", async () => {
  await assert.rejects(importAndOpenProject(file, {
    importArchive: async () => "/private/import-bad",
    openProject: async () => { throw new Error("invalid map"); },
    discardFailedImport: async () => { throw new Error("permission denied"); },
    isActiveProject: () => false,
  }), (error) => error.message.includes("invalid map")
    && error.message.includes("permission denied")
    && error.cause?.message === "invalid map");
});
