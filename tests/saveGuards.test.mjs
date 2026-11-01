import test from "node:test";
import assert from "node:assert/strict";
import { saveThenMarkClean, mapStillUnchanged } from "../src/services/saveGuards.ts";

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

test("painting again during a pending save rejects and keeps the map dirty", async () => {
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  let dirty = true;
  let revision = 5;
  const savedRevision = revision;
  const operation = saveThenMarkClean(
    () => pending,
    () => { dirty = false; },
    () => revision === savedRevision,
  );
  revision += 1; // A new tile paint occurred while the native write was pending.
  resolveSave();
  await assert.rejects(operation, /Map changed while saving/);
  assert.equal(dirty, true, "newer tile edits must not be marked saved");
});

test("switching maps during a pending save cannot clear the new map's dirty flag", async () => {
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  let dirty = true;
  let activeMapId = 1;
  const operation = saveThenMarkClean(
    () => pending,
    () => { dirty = false; },
    () => activeMapId === 1,
  );
  activeMapId = 2;
  resolveSave();
  await assert.rejects(operation, /Map changed while saving/);
  assert.equal(dirty, true);
});

test("unchanged map revision still clears dirty after the native write succeeds", async () => {
  let dirty = true;
  const revision = 7;
  await saveThenMarkClean(
    async () => {},
    () => { dirty = false; },
    () => revision === 7,
  );
  assert.equal(dirty, false);
});


test("map navigation cannot discard painting performed during destination graphics load", () => {
  const map = { tiles: [1, 2, 3] };
  const snapshot = { projectPath: "/private/project", map, revision: 7 };
  assert.equal(mapStillUnchanged(snapshot, { ...snapshot, revision: 8 }), false);
  assert.equal(mapStillUnchanged(snapshot, { ...snapshot, map: { ...map } }), false);
  assert.equal(mapStillUnchanged(snapshot, { ...snapshot, projectPath: "/private/other" }), false);
  assert.equal(mapStillUnchanged(snapshot, { ...snapshot }), true);
});

test("pending navigation save must snapshot mutable tile data", async () => {
  const map = { tiles: [1, 2, 3] };
  const source = map.tiles.slice();
  const original = { projectPath: "/private/project", map, revision: 4 };
  let resolveSave;
  const write = new Promise(resolve => { resolveSave = resolve; });
  const operation = saveThenMarkClean(
    () => write,
    () => {},
    () => mapStillUnchanged(original, { ...original, revision: 5 }),
  );
  map.tiles[0] = 99;
  assert.deepEqual(source, [1, 2, 3], "native save must receive immutable snapshot");
  resolveSave();
  await assert.rejects(operation, /Map changed while saving/);
});
