import assert from "node:assert/strict";
import test from "node:test";
import { saveBeforeMapNavigation } from "../src/services/mapNavigationSave.ts";

test("clean map navigation proceeds without a save or prompt", async () => {
  let called = false;
  assert.equal(await saveBeforeMapNavigation(
    () => false, async () => { called = true; return true; },
    async () => { called = true; }, () => true,
  ), true);
  assert.equal(called, false);
});

test("cancel keeps current map and unsaved event active", async () => {
  let saves = 0;
  assert.equal(await saveBeforeMapNavigation(
    () => true, async () => false, async () => { saves++; }, () => true,
  ), false);
  assert.equal(saves, 0);
});

test("event and PBS changes must finish saving before navigation", async () => {
  let dirty = true;
  let completed = false;
  const result = await saveBeforeMapNavigation(
    () => dirty, async () => true,
    async () => { await Promise.resolve(); dirty = false; completed = true; },
    () => true,
  );
  assert.equal(result, true);
  assert.equal(completed, true);
});

test("failed save rejects and never permits navigation", async () => {
  await assert.rejects(
    saveBeforeMapNavigation(() => true, async () => true,
      async () => { throw new Error("event write failed"); }, () => true),
    /event write failed/,
  );
});

test("new edits made during save fail closed", async () => {
  await assert.rejects(
    saveBeforeMapNavigation(() => true, async () => true, async () => {},
      () => true),
    /Unsaved edits remain/,
  );
});

test("stale map request cannot navigate after confirmation", async () => {
  let current = true;
  let saved = false;
  assert.equal(await saveBeforeMapNavigation(
    () => true,
    async () => { current = false; return true; },
    async () => { saved = true; },
    () => current,
  ), false);
  assert.equal(saved, false);
});
