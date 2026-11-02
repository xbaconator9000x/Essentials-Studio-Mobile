import test from "node:test";
import assert from "node:assert/strict";
import { mapIds, validateMap, validateEvent, scriptIds } from "../scripts/private-project-sweep.mjs";

const fixtureMap = () => ({
  id: 1, width: 2, height: 2, tileset_id: 1,
  tiles: Array(12).fill(0), events: [{ id: 7, page_count: 1 }],
});

test("full-project sweep sorts and bounds map IDs", () => {
  assert.deepEqual(mapIds({ map_infos: { 2: {}, 1: {} } }), [1, 2]);
  assert.throws(() => mapIds({ map_infos: { 0: {} } }), /invalid map IDs/);
  assert.throws(() => mapIds({ map_infos: {} }), /no maps/);
});
test("full-project sweep enforces three XP layers and i16 tile fidelity", () => {
  assert.deepEqual(validateMap(fixtureMap(), 1), { events: 1, tilesetId: 1 });
  assert.throws(() => validateMap({ ...fixtureMap(), tiles: [0, 1] }, 1), /three XP layers/);
  assert.throws(() => validateMap({ ...fixtureMap(), tiles: Array(12).fill(32768) }, 1), /non-i16/);
  assert.throws(() => validateMap({ ...fixtureMap(), events: [
    { id: 7, page_count: 1 }, { id: 7, page_count: 1 },
  ] }, 1), /Duplicate\/invalid/);
});
test("full-project sweep checks native event pages and command structures", () => {
  const info = { id: 7, page_count: 1 };
  assert.deepEqual(validateEvent({ id: 7, pages: [
    { list: [{ code: 101, indent: 0, parameters: ["test"] }] },
  ] }, 1, info), { pages: 1, commands: 1 });
  assert.throws(() => validateEvent({ id: 7, pages: [] }, 1, info), /page count/);
  assert.throws(() => validateEvent({ id: 7, pages: [
    { list: [{ code: 101, indent: 0 }] },
  ] }, 1, info), /Malformed event command/);
});

test("full-project sweep requires populated, uniquely-addressable Ruby scripts", () => {
  assert.deepEqual(scriptIds([{ id: 1, title: "First" }, { id: 2, title: "Second" }]), [1, 2]);
  assert.throws(() => scriptIds([]), /no executable script entries/);
  assert.throws(() => scriptIds([{ id: 1 }, { id: 1 }]), /Duplicate Ruby script IDs/);
  assert.throws(() => scriptIds([{ id: "1" }]), /Invalid Ruby script ID/);
  assert.throws(() => scriptIds([{ id: Number.MAX_SAFE_INTEGER + 1 }]), /Invalid Ruby script ID/);
});
