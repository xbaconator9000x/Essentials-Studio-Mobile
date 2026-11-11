import test from "node:test";
import assert from "node:assert/strict";
import {
  paintTile, paintRectangle, floodFill, copyTileRegion, pasteTileRegion, sampleMapTile,
  applyAction, revertAction,
} from "../src/services/mapEditor.ts";

function map(width = 3, height = 2) {
  return { id: 1, width, height, tileset_id: 1,
    tiles: new Array(width * height * 3).fill(0), events: [] };
}

test("XP layer 2 paint and undo/redo never alter lower layers", () => {
  const data = map();
  const before = data.tiles.slice();
  const changes = paintTile(data, 1, 1, 2, 1024);
  assert.deepEqual(changes, [{ x: 1, y: 1, layer: 2, oldTileId: 0, newTileId: 1024 }]);
  assert.deepEqual(data.tiles.slice(0, 12), before.slice(0, 12));
  assert.equal(data.tiles[16], 1024);
  revertAction(data, { type: "paint", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, before);
  applyAction(data, { type: "paint", changes, timestamp: 0 });
  assert.equal(data.tiles[16], 1024);
});

test("invalid layers, IDs, coordinates and incomplete Tables cannot mutate a map", () => {
  const data = map();
  const before = data.tiles.slice();
  for (const layer of [-1, 3, 1.5, Number.NaN]) {
    assert.deepEqual(paintTile(data, 0, 0, layer, 384), []);
    assert.deepEqual(paintRectangle(data, 0, 0, 2, 1, layer, 384), []);
    assert.deepEqual(floodFill(data, 0, 0, layer, 384), []);
  }
  for (const id of [-1, 32768, 0.5, Number.NaN, Infinity]) {
    assert.deepEqual(paintTile(data, 0, 0, 0, id), []);
    assert.deepEqual(paintRectangle(data, 0, 0, 2, 1, 0, id), []);
    assert.deepEqual(floodFill(data, 0, 0, 0, id), []);
  }
  for (const x of [-1, 0.5, NaN, 3]) {
    assert.deepEqual(paintTile(data, x, 0, 0, 384), []);
    assert.deepEqual(floodFill(data, x, 0, 0, 384), []);
  }
  assert.deepEqual(paintRectangle(data, 10, 10, 12, 12, 0, 384), []);
  applyAction(data, { type: "paint", timestamp: 0, changes: [
    { x: 0, y: 0, layer: -1, oldTileId: 0, newTileId: 384 },
    { x: 0, y: 0, layer: 3, oldTileId: 0, newTileId: 384 },
  ] });
  assert.deepEqual(data.tiles, before);
  data.tiles.pop();
  assert.deepEqual(paintTile(data, 0, 0, 0, 384), []);
});

test("three XP layers copy/paste without flattening; malformed clipboard rejects atomically", () => {
  const source = map();
  source.tiles[0] = 384;
  source.tiles[6] = 48;
  source.tiles[12] = 1024;
  const clipboard = copyTileRegion(source, { x1: 0, y1: 0, x2: 1, y2: 1 }, -1);
  assert.equal(clipboard.layers.length, 3);
  const destination = map();
  const changes = pasteTileRegion(destination, clipboard, { x: 1, y: 0 }, -1);
  assert.equal(changes.length, 3);
  assert.equal(destination.tiles[1], 384);
  assert.equal(destination.tiles[7], 48);
  assert.equal(destination.tiles[13], 1024);
  const saved = destination.tiles.slice();
  const invalid = { ...clipboard, layers: clipboard.layers.map(l => l.slice()) };
  invalid.layers[2][3] = 32768;
  assert.deepEqual(pasteTileRegion(destination, invalid, { x: 0, y: 0 }, -1), []);
  assert.deepEqual(destination.tiles, saved);
  assert.deepEqual(copyTileRegion(source, { x1: 99, y1: 99, x2: 100, y2: 100 }, -1),
    { width: 0, height: 0, layers: [[], [], []] });
});

test("large flood fill changes only the chosen XP layer and remains undoable", () => {
  const data = map(192, 192);
  const changes = floodFill(data, 0, 0, 1, 384);
  assert.equal(changes.length, 192 * 192);
  assert.ok(data.tiles.slice(0, 192 * 192).every(v => v === 0));
  assert.ok(data.tiles.slice(192 * 192, 2 * 192 * 192).every(v => v === 384));
  assert.ok(data.tiles.slice(2 * 192 * 192).every(v => v === 0));
  revertAction(data, { type: "fill", changes, timestamp: 0 });
  assert.ok(data.tiles.every(v => v === 0));
});

test("signed i16 sentinel cells survive undo and clipboard without being paintable", () => {
  const data = map();
  data.tiles[0] = -1;
  const changes = paintTile(data, 0, 0, 0, 384);
  assert.equal(data.tiles[0], 384);
  revertAction(data, { type: "paint", changes, timestamp: 0 });
  assert.equal(data.tiles[0], -1);
  const clip = copyTileRegion(data, { x1: 0, y1: 0, x2: 0, y2: 0 }, 0);
  const dest = map();
  const pasted = pasteTileRegion(dest, clip, { x: 2, y: 1 }, 0);
  assert.equal(pasted.length, 1);
  assert.equal(dest.tiles[5], -1);
  assert.deepEqual(paintTile(dest, 2, 1, 0, -1), []);
});


test("a single-layer tile clipboard pastes into the chosen destination layer and undoes exactly", () => {
  const source = { id: 1, width: 2, height: 2, tileset_id: 1, tiles: [384, 385, 386, 387, ...Array(8).fill(0)], events: [] };
  const destination = { id: 2, width: 2, height: 2, tileset_id: 1, tiles: Array(12).fill(0), events: [] };
  const clip = copyTileRegion(source, { x1: 0, y1: 0, x2: 1, y2: 1 }, 0);
  const changes = pasteTileRegion(destination, clip, { x: 0, y: 0 }, 2);
  assert.deepEqual(destination.tiles, [...Array(8).fill(0), 384, 385, 386, 387]);
  assert.equal(changes.length, 4);
  revertAction(destination, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(destination.tiles, Array(12).fill(0));
});


test("map tile sampling respects active layer, visible XP layers, and bounds", () => {
  const data = { id: 1, width: 1, height: 1, tileset_id: 1, tiles: [384, 385, 0], events: [] };
  assert.deepEqual(sampleMapTile(data, 0, 0, 0), { tileId: 384, layer: 0 });
  assert.deepEqual(sampleMapTile(data, 0, 0, -1), { tileId: 385, layer: 1 });
  assert.deepEqual(sampleMapTile(data, 0, 0, -1, [true, false, true]), { tileId: 384, layer: 0 });
  assert.deepEqual(sampleMapTile(data, 0, 0, 2), { tileId: 0, layer: 2 });
  assert.equal(sampleMapTile(data, 1, 0, -1), null);
  assert.equal(sampleMapTile(data, 0, 0, 3), null);
  data.tiles[2] = -1;
  assert.equal(sampleMapTile(data, 0, 0, 2), null);
});

test("empty-tile preserving map paste retains destination across XP layers and supports undo", () => {
  const source = map(2, 1);
  source.tiles.splice(0, source.tiles.length, 384, 0, 0, 1024, 0, -1);
  const clipboard = copyTileRegion(source, { x1: 0, y1: 0, x2: 1, y2: 0 }, -1);
  const destination = map(2, 1);
  destination.tiles.splice(0, destination.tiles.length, 400, 401, 500, 501, 600, 601);
  const before = destination.tiles.slice();
  const changes = pasteTileRegion(destination, clipboard, { x: 0, y: 0 }, -1, "preserve");
  assert.deepEqual(destination.tiles, [384, 401, 500, 1024, 600, -1]);
  assert.equal(changes.length, 3);
  revertAction(destination, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(destination.tiles, before);
  applyAction(destination, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(destination.tiles, [384, 401, 500, 1024, 600, -1]);
});

test("map paste replace mode still clears zero tiles and invalid mode is atomic", () => {
  const destination = map(2, 1);
  destination.tiles[0] = 400;
  destination.tiles[1] = 401;
  const clipboard = { width: 2, height: 1, layers: [[0, 384], [], []] };
  assert.deepEqual(pasteTileRegion(destination, clipboard, { x: 0, y: 0 }, 0, "invalid"), []);
  assert.deepEqual(destination.tiles.slice(0, 2), [400, 401]);
  const changes = pasteTileRegion(destination, clipboard, { x: 0, y: 0 }, 0, "replace");
  assert.equal(changes.length, 2);
  assert.deepEqual(destination.tiles.slice(0, 2), [0, 384]);
});

test("flood fill respects an irregular barrier and preserves other XP layers", () => {
  const data = map(80, 60);
  const area = data.width * data.height;
  for (let y = 0; y < data.height; y++) data.tiles[y * data.width + 40] = 1024;
  data.tiles[area + 20] = -1;
  const original = data.tiles.slice();
  const changes = floodFill(data, 0, 0, 0, 384);
  assert.equal(changes.length, 40 * 60);
  assert.equal(data.tiles[39], 384);
  assert.equal(data.tiles[40], 1024);
  assert.equal(data.tiles[41], 0);
  assert.deepEqual(data.tiles.slice(area), original.slice(area));
  revertAction(data, { type: "fill", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, original);
  applyAction(data, { type: "fill", changes, timestamp: 0 });
  assert.equal(data.tiles[39], 384);
});
