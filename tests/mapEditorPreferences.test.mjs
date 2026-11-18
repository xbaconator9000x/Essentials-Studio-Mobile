import test from "node:test";
import assert from "node:assert/strict";
import {
  mapEventPinsPreferenceKey,
  readMapEventPinsVisible,
  writeMapEventPinsVisible,
} from "../src/services/mapEditorPreferences.ts";

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("event pin visibility persists separately for each imported project and map", () => {
  const storage = makeStorage();
  assert.equal(readMapEventPinsVisible("/project/a", 2, storage), true);
  writeMapEventPinsVisible("/project/a", 2, false, storage);
  assert.equal(readMapEventPinsVisible("/project/a", 2, storage), false);
  assert.equal(readMapEventPinsVisible("/project/a", 3, storage), true);
  assert.equal(readMapEventPinsVisible("/project/b", 2, storage), true);
  assert.match(mapEventPinsPreferenceKey("/project/a", 2), /:2$/);
});

test("missing project/map ids and unavailable storage safely default to visible", () => {
  assert.equal(readMapEventPinsVisible(undefined, 2, makeStorage()), true);
  assert.equal(mapEventPinsPreferenceKey("/project", 0), null);
  const unavailable = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); } };
  assert.equal(readMapEventPinsVisible("/project", 1, unavailable), true);
  assert.doesNotThrow(() => writeMapEventPinsVisible("/project", 1, false, unavailable));
});
