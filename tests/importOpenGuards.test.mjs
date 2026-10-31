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

test("cancelled Android document selection leaves the project untouched", async () => {
  let called = false;
  await importAndOpenProject(null, {
    importArchive: async () => { called = true; return "/private/import-cancelled"; },
    openProject: async () => { called = true; },
    discardFailedImport: async () => { called = true; },
    isActiveProject: () => false,
  });
  assert.equal(called, false);
});

test("Android document import failures do not open or discard a project", async () => {
  const calls = [];
  const uri = "content://com.android.providers.downloads.documents/document/42";
  await assert.rejects(importAndOpenProject(uri, {
    importArchive: async (selectedUri) => {
      assert.equal(selectedUri, uri);
      throw new Error("Android document stream failed");
    },
    openProject: async () => { calls.push("open"); },
    discardFailedImport: async () => { calls.push("discard"); },
    isActiveProject: () => false,
  }), /Android document stream failed/);
  assert.deepEqual(calls, []);
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

test("native bridge errors remain verbatim and rejected private imports are discarded", async () => {
  const uploadError = "ZIP contains files outside its single project folder";
  const uploadCalls = [];
  await assert.rejects(importAndOpenProject(file, {
    importArchive: async () => { throw uploadError; },
    openProject: async () => { uploadCalls.push("open"); },
    discardFailedImport: async () => { uploadCalls.push("discard"); },
    isActiveProject: () => false,
  }), (error) => error === uploadError);
  assert.deepEqual(uploadCalls, []);

  const preflightError = "Failed to parse map: invalid Ruby Marshal stream";
  const openCalls = [];
  await assert.rejects(importAndOpenProject(file, {
    importArchive: async () => "/private/import-malformed",
    openProject: async () => { throw preflightError; },
    discardFailedImport: async (path) => { openCalls.push(["discard", path]); },
    isActiveProject: () => false,
  }), (error) => error === preflightError);
  assert.deepEqual(openCalls, [["discard", "/private/import-malformed"]]);
});
