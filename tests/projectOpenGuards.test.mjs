import test from "node:test";
import assert from "node:assert/strict";
import { inspectProjectBeforeOpen } from "../src/services/projectOpenGuards.ts";

const candidate = { path: "/private/project", edit_map_id: 1 };
const map = { id: 1, width: 2, height: 2, tileset_id: 3, tiles: Array(12).fill(384) };

test("read-only preflight checks initial XP map, all three layers and tileset", async () => {
  const calls = [];
  const result = await inspectProjectBeforeOpen("/requested", {
    openProject: async (path) => { calls.push(["open", path]); return candidate; },
    loadMap: async (path, id) => { calls.push(["map", path, id]); return map; },
    loadTileset: async (path, id) => { calls.push(["tileset", path, id]); return { id }; },
  });
  assert.equal(result, candidate);
  assert.deepEqual(calls, [
    ["open", "/requested"],
    ["map", "/private/project", 1],
    ["tileset", "/private/project", 3],
  ]);
});

test("bad map or tileset rejects before a caller can replace its active project", async () => {
  let active = { path: "/private/previous" };
  const switchProject = async (io) => {
    const next = await inspectProjectBeforeOpen("/private/broken", io);
    active = next;
  };
  const base = {
    openProject: async () => candidate,
    loadMap: async () => map,
    loadTileset: async () => ({ id: 3 }),
  };
  await assert.rejects(switchProject({
    ...base, loadMap: async () => ({ ...map, tiles: Array(8).fill(384) }),
  }), /three-layer/);
  assert.equal(active.path, "/private/previous");
  await assert.rejects(switchProject({
    ...base, loadTileset: async () => { throw new Error("Tilesets.rxdata invalid"); },
  }), /Tilesets.rxdata/);
  assert.equal(active.path, "/private/previous");
  await assert.rejects(switchProject({
    ...base, loadMap: async () => { throw new Error("Map001.rxdata invalid"); },
  }), /Map001.rxdata/);
  assert.equal(active.path, "/private/previous");
});

test("empty project map selection skips initial map preflight", async () => {
  const result = await inspectProjectBeforeOpen("/private/empty", {
    openProject: async () => ({ ...candidate, edit_map_id: 0 }),
    loadMap: async () => { throw new Error("must not load"); },
    loadTileset: async () => { throw new Error("must not load"); },
  });
  assert.equal(result.edit_map_id, 0);
});

test("invalid map IDs and dimensions cannot reach the active editor", async () => {
  for (const broken of [
    { ...map, id: 2 },
    { ...map, width: -1 },
    { ...map, height: 0 },
    { ...map, width: 2 ** 53 },
  ]) {
    await assert.rejects(inspectProjectBeforeOpen("/private/broken", {
      openProject: async () => candidate,
      loadMap: async () => broken,
      loadTileset: async () => { throw new Error("should not load"); },
    }), /three-layer/);
  }
});
