import test from "node:test";
import assert from "node:assert/strict";
import { getTile } from "../src/types/index.ts";
import { paintTile } from "../src/services/mapEditor.ts";
import { clampMapViewport, resolveMapTapTarget } from "../src/services/mapGestures.ts";

test("map painting and event taps include the bottom-right edge but reject outside cells", () => {
  const map = {
    id: 1,
    width: 3,
    height: 2,
    tileset_id: 1,
    tiles: Array(3 * 2 * 3).fill(0),
    events: [{ id: 5, name: "Edge event", x: 2, y: 1 }],
  };
  assert.equal(paintTile(map, 0, 0, 0, 384).length > 0, true);
  assert.equal(paintTile(map, 2, 1, 0, 385).length > 0, true);
  const before = map.tiles.slice();
  assert.deepEqual(paintTile(map, -1, 0, 0, 386), []);
  assert.deepEqual(paintTile(map, 3, 1, 0, 386), []);
  assert.deepEqual(map.tiles, before);
  assert.equal(getTile(map.tiles, 2, 1, 0, map.width, map.height), 385);
  assert.deepEqual(resolveMapTapTarget({ x: 2, y: 1 }, 3, 2, 3, map.events), {
    type: "event",
    event: map.events[0],
  });
  assert.deepEqual(clampMapViewport(50, 50, 3, 2, 32, 32, 1), { x: 2, y: 1 });
});
