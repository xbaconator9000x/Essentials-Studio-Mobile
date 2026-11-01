import assert from "node:assert/strict";
import test from "node:test";
import { collectDirtyScriptPayload } from "./scriptSavePayload.ts";

const scripts = [
  { id: 1, title: "Main" },
  { id: 2, title: "Utility" },
  { id: 3, title: "Battle" },
];

test("edited script sends one entry without reading untouched sources", async () => {
  const calls: number[] = [];
  const result = await collectDirtyScriptPayload(
    scripts, new Set([2]), new Map([[2, "puts :edited"]]),
    async (id) => { calls.push(id); return "untouched"; },
  );
  assert.deepEqual(result, [{ id: 2, title: "Utility", source: "puts :edited" }]);
  assert.deepEqual(calls, []);
});

test("rename of unopened script reads only its original source", async () => {
  const calls: number[] = [];
  const result = await collectDirtyScriptPayload(
    [{ id: 1, title: "Renamed" }, ...scripts.slice(1)],
    new Set([1]), new Map(),
    async (id) => { calls.push(id); return "original source"; },
  );
  assert.deepEqual(result, [{ id: 1, title: "Renamed", source: "original source" }]);
  assert.deepEqual(calls, [1]);
});

test("no dirty scripts never read sources", async () => {
  const result = await collectDirtyScriptPayload(
    scripts, new Set(), new Map(),
    async () => { throw new Error("unexpected load"); },
  );
  assert.deepEqual(result, []);
});

test("failed source read aborts rather than silently dropping a dirty script", async () => {
  await assert.rejects(
    collectDirtyScriptPayload(scripts, new Set([3]), new Map(), async () => {
      throw new Error("source unavailable");
    }),
    /source unavailable/,
  );
});

test("stale dirty ID is rejected before clearing unsaved state", async () => {
  await assert.rejects(
    collectDirtyScriptPayload(scripts, new Set([99]), new Map(), async () => ""),
    /missing from the current list/,
  );
});

test("empty cached source is valid and does not trigger reload", async () => {
  const result = await collectDirtyScriptPayload(
    scripts, new Set([1]), new Map([[1, ""]]),
    async () => { throw new Error("unexpected load"); },
  );
  assert.deepEqual(result, [{ id: 1, title: "Main", source: "" }]);
});
