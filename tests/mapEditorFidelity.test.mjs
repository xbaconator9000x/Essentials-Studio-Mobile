import test from "node:test";
import assert from "node:assert/strict";
import {
  paintTile, paintRectangle, floodFill, copyTileRegion, pasteTileRegion,
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
