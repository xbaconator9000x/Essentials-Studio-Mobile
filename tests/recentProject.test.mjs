import test from "node:test";
import assert from "node:assert/strict";
import {
  getLastProjectPath,
  getRecentProjectPaths,
  rememberLastProjectPath,
  rememberRecentProjectPath,
} from "../src/services/recentProject.ts";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => { values.set(key, next); },
  };
}

test("remembers a project path across app launches", () => {
  const projectStorage = storage();
  rememberLastProjectPath("/private/projects/import-123", projectStorage);
  assert.equal(getLastProjectPath(projectStorage), "/private/projects/import-123");
});

test("keeps a bounded most-recent-first project list for in-app switching", () => {
  const projectStorage = storage();
  for (let index = 0; index < 10; index++) {
    rememberRecentProjectPath(`/private/projects/${index}`, projectStorage);
  }
  rememberRecentProjectPath("/private/projects/5", projectStorage);

  assert.deepEqual(getRecentProjectPaths(projectStorage), [
    "/private/projects/5",
    "/private/projects/9",
    "/private/projects/8",
    "/private/projects/7",
    "/private/projects/6",
    "/private/projects/4",
    "/private/projects/3",
    "/private/projects/2",
  ]);
  assert.equal(getLastProjectPath(projectStorage), "/private/projects/5");
});

test("filters malformed recent entries and tolerates corrupt or unavailable storage", () => {
  const projectStorage = storage({
    "essentials-studio:recent-projects": JSON.stringify([
      "/project",
      "/project",
      " /bad ",
      null,
      "/project\0bad",
      "x".repeat(4097),
    ]),
  });
  assert.deepEqual(getRecentProjectPaths(projectStorage), ["/project"]);
  assert.deepEqual(getRecentProjectPaths(storage({
    "essentials-studio:recent-projects": "{",
  })), []);

  const unavailableStorage = {
    getItem: () => { throw new Error("storage denied"); },
    setItem: () => { throw new Error("storage quota"); },
  };
  assert.deepEqual(getRecentProjectPaths(unavailableStorage), []);
  assert.doesNotThrow(() => rememberRecentProjectPath("/project", unavailableStorage));
});

test("ignores malformed paths and storage failures without blocking project open", () => {
  for (const path of ["", " /project ", "/project\0bad", "x".repeat(4097)]) {
    const projectStorage = storage({ "essentials-studio:last-project": path });
    assert.equal(getLastProjectPath(projectStorage), null);
    rememberLastProjectPath(path, projectStorage);
    assert.equal(getLastProjectPath(projectStorage), null);
  }

  const unavailableStorage = {
    getItem: () => { throw new Error("storage denied"); },
    setItem: () => { throw new Error("storage quota"); },
  };
  assert.equal(getLastProjectPath(unavailableStorage), null);
  assert.doesNotThrow(() => rememberLastProjectPath("/project", unavailableStorage));
  assert.equal(getLastProjectPath(null), null);
  assert.doesNotThrow(() => rememberLastProjectPath("/project", null));
});
