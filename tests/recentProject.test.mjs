import test from "node:test";
import assert from "node:assert/strict";
import { getLastProjectPath, rememberLastProjectPath } from "../src/services/recentProject.ts";

function storage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
  };
}

test("remembers a project path across app launches", () => {
  const projectStorage = storage();
  rememberLastProjectPath("/private/projects/import-123", projectStorage);
  assert.equal(getLastProjectPath(projectStorage), "/private/projects/import-123");
});

test("ignores malformed paths and storage failures without blocking project open", () => {
  for (const path of ["", " /project ", "/project\0bad", "x".repeat(4097)]) {
    const projectStorage = storage(path);
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
