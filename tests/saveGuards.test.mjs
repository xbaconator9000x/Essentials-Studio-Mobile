import test from "node:test";
import assert from "node:assert/strict";
import { saveThenMarkClean } from "../src/services/saveGuards.ts";

test("successful disk write clears dirty state only after the write resolves", async () => {
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  let dirty = true;
  const operation = saveThenMarkClean(() => pending, () => { dirty = false; });
  assert.equal(dirty, true, "dirty flag cleared before disk write completed");
  resolveSave();
  await operation;
  assert.equal(dirty, false);
});

test("failed disk write preserves dirty state and rejects to Save All", async () => {
  let dirty = true;
  const error = new Error("ENOSPC");
  await assert.rejects(
    saveThenMarkClean(async () => { throw error; }, () => { dirty = false; }),
    (actual) => actual === error,
  );
  assert.equal(dirty, true, "failed write must never clear dirty state");
});
