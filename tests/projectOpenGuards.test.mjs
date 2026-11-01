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

test("invalid initial map IDs cannot silently bypass XP preflight", async () => {
  for (const edit_map_id of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    let mapCalls = 0;
    await assert.rejects(inspectProjectBeforeOpen("/private/broken", {
      openProject: async () => ({ ...candidate, edit_map_id }),
      loadMap: async () => { mapCalls++; return map; },
      loadTileset: async () => ({ id: 3 }),
    }), /invalid initial XP map ID/);
    assert.equal(mapCalls, 0, "rejected ID should never load a map");
  }
});

test("invalid tile cells and tileset IDs reject before switching projects", async () => {
  const base = {
    openProject: async () => candidate,
    loadMap: async () => map,
    loadTileset: async () => ({ id: 3 }),
  };
  for (const broken of [
    { ...map, width: -2, height: -2 },
    { ...map, width: 1.5, height: 8 },
    { ...map, tileset_id: 0 },
    { ...map, tiles: Array(12).fill(384).map((v, i) => i === 5 ? 32768 : v) },
    { ...map, tiles: Array(12).fill(384).map((v, i) => i === 5 ? 3.5 : v) },
  ]) {
    await assert.rejects(inspectProjectBeforeOpen("/private/broken", {
      ...base,
      loadMap: async () => broken,
      loadTileset: async () => { throw new Error("should not load invalid map tileset"); },
    }), /three-layer/);
  }
  await assert.rejects(inspectProjectBeforeOpen("/private/broken", {
    ...base,
    loadTileset: async () => ({ id: 4 }),
  }), /mismatched tileset/);
});


test("preparing the first map returns its validated render data without duplicate native loads", async () => {
  const { prepareProjectBeforeOpen } = await import("../src/services/projectOpenGuards.ts");
  const calls = [];
  const prepared = await prepareProjectBeforeOpen("/candidate", {
    openProject: async () => { calls.push("project"); return candidate; },
    loadMap: async () => { calls.push("map"); return map; },
    loadTileset: async () => { calls.push("tileset"); return { id: 3, tileset_name: "Synthetic", autotile_names: [] }; },
  });
  assert.equal(prepared.project, candidate);
  assert.equal(prepared.initialMap, map);
  assert.equal(prepared.initialTileset.id, 3);
  assert.deepEqual(calls, ["project", "map", "tileset"]);
});

test("preparing a corrupt project never returns partial initial render state", async () => {
  const { prepareProjectBeforeOpen } = await import("../src/services/projectOpenGuards.ts");
  let previous = "/private/working-project";
  await assert.rejects(async () => {
    const prepared = await prepareProjectBeforeOpen("/candidate", {
      openProject: async () => candidate,
      loadMap: async () => map,
      loadTileset: async () => { throw new Error("Tileset decode failed"); },
    });
    previous = prepared.project.path;
  }, /Tileset decode failed/);
  assert.equal(previous, "/private/working-project");
});

test("newer project-open lease invalidates stale preparation and async metadata", async () => {
  const { ProjectOpenCoordinator } = await import("../src/services/projectOpenGuards.ts");
  const coordinator = new ProjectOpenCoordinator();
  const older = coordinator.begin();
  assert.equal(older.isCurrent(), true);
  const newer = coordinator.begin();
  assert.equal(older.isCurrent(), false);
  assert.equal(newer.isCurrent(), true);
  assert.throws(() => older.assertCurrent(), /superseded/);
  assert.doesNotThrow(() => newer.assertCurrent());

  let activeProject = "existing";
  let pbsIndex = "existing-index";
  const commit = (lease, name) => {
    lease.assertCurrent();
    activeProject = name;
  };
  const publishLatePbs = (lease, index) => {
    if (lease.isCurrent()) pbsIndex = index;
  };
  assert.throws(() => commit(older, "stale"), /superseded/);
  commit(newer, "latest");
  publishLatePbs(older, "stale-index");
  assert.equal(activeProject, "latest");
  assert.equal(pbsIndex, "existing-index");
  publishLatePbs(newer, "latest-index");
  assert.equal(pbsIndex, "latest-index");
});
