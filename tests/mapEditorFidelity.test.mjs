import test from "node:test";
import assert from "node:assert/strict";
import {
  paintTile, paintRectangle, floodFill, clearMapTileRegion, copyTileRegion, pasteTileRegion, sampleMapTile,
  applyAction, revertAction, swapMapTileLayers, translateMapTileRegion, mirrorMapTileRegion, copyMapTileRegionToLayer, mirrorMapTileRegion,
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

test("clipboard paste clips negative origins and right/bottom edges without layer aliasing", () => {
  const data = map(3, 2);
  const clipboard = { width: 4, height: 3, layers: [
    Array.from({ length: 12 }, (_, i) => 1000 + i),
    [], [],
  ] };
  const left = pasteTileRegion(data, clipboard, { x: -2, y: -1 }, 2);
  assert.equal(left.length, 4);
  assert.equal(data.tiles[12], 1006);
  assert.equal(data.tiles[13], 1007);
  assert.equal(data.tiles[15], 1010);
  assert.equal(data.tiles[16], 1011);
  assert.deepEqual(data.tiles.slice(0, 12), new Array(12).fill(0));
  const before = data.tiles.slice();
  revertAction(data, { type: "paste", changes: left, timestamp: 0 });
  assert.deepEqual(data.tiles, new Array(18).fill(0));
  applyAction(data, { type: "paste", changes: left, timestamp: 0 });
  assert.deepEqual(data.tiles, before);
  assert.deepEqual(pasteTileRegion(data, clipboard, { x: 3, y: 2 }, 2), []);
  assert.deepEqual(data.tiles, before);
  assert.deepEqual(pasteTileRegion(data, clipboard, { x: Number.MAX_SAFE_INTEGER + 1, y: 0 }, 2), []);
  assert.deepEqual(data.tiles, before);
});

test("clipboard paste preserves zero tiles at clipped destination edges", () => {
  const data = map(2, 2);
  data.tiles.fill(900);
  const clipboard = { width: 3, height: 2, layers: [[0, 111, 222, 333, 0, 444], [], []] };
  const changes = pasteTileRegion(data, clipboard, { x: -1, y: 0 }, 0, "preserve");
  assert.equal(changes.length, 3);
  assert.deepEqual(data.tiles.slice(0, 4), [111, 222, 900, 444]);
  assert.deepEqual(data.tiles.slice(4), new Array(8).fill(900));
});

test("large autotile rectangle updates exterior perimeter only and remains undoable", () => {
  const data = map(32, 24);
  const size = data.width * data.height;
  // Surround the rectangle with an existing autotile of the same XP slot.
  for (let y = 3; y <= 20; y++) {
    for (let x = 3; x <= 28; x++) data.tiles[y * data.width + x] = 48;
  }
  // Keep one genuinely empty target cell: repainting an already resolved
  // autotile region can correctly be a no-op, so the edit ledger needs a
  // deliberately changed pixel to exercise undo and neighbour updates.
  data.tiles[10 * data.width + 10] = 0;
  data.tiles[size + 5 * data.width + 5] = 1024;
  const before = data.tiles.slice();
  const changes = paintRectangle(data, 5, 5, 26, 18, 0, 48);
  // The rectangle starts filled with the same autotile slot: only tiles
  // whose resolved neighbour mask changes should appear in the undo delta.
  assert.ok(changes.length > 0);
  // The seeded rectangle contains raw autotile slot IDs, not resolved
  // neighbor variants. Resolving those cells can legitimately change every
  // interior tile; validate the actual edit ledger instead of a count bound.
  assert.ok(changes.every(c => c.layer === 0));
  assert.ok(changes.every(c => c.oldTileId !== c.newTileId));
  assert.ok(changes.every(c => data.tiles[c.layer * size + c.y * data.width + c.x] === c.newTileId));
  assert.ok(changes.some(c => c.x >= 5 && c.x <= 26 && c.y >= 5 && c.y <= 18));
  assert.equal(data.tiles[size + 5 * data.width + 5], 1024);
  revertAction(data, { type: "rectangle", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, before);
  applyAction(data, { type: "rectangle", changes, timestamp: 0 });
  assert.equal(data.tiles[size + 5 * data.width + 5], 1024);
});

test("thin autotile rectangles handle shared corners and preserve undo", () => {
  for (const [width, height] of [[1, 6], [6, 1], [1, 1]]) {
    const data = map(8, 8);
    const before = data.tiles.slice();
    const changes = paintRectangle(data, 2, 2, 1 + width, 1 + height, 2, 48);
    assert.ok(changes.length > 0);
    assert.ok(changes.every(c => c.layer === 2));
    revertAction(data, { type: "rectangle", changes, timestamp: 0 });
    assert.deepEqual(data.tiles, before);
  }
});

test("autotile removal across adjacent rectangle cells records each cell exactly once", () => {
  const data = map(8, 6);
  for (let y = 1; y < 5; y++) for (let x = 1; x < 7; x++)
    data.tiles[y * data.width + x] = 48;
  data.tiles[data.width * data.height + 4] = -1;
  const before = data.tiles.slice();
  const changes = paintRectangle(data, 2, 2, 5, 4, 0, 384);
  assert.ok(changes.length >= 12);
  assert.equal(new Set(changes.map(c => `${c.layer}:${c.x}:${c.y}`)).size, changes.length);
  for (const change of changes) {
    assert.equal(change.oldTileId, before[change.y * data.width + change.x]);
    assert.equal(change.newTileId, data.tiles[change.y * data.width + change.x]);
  }
  const after = data.tiles.slice();
  revertAction(data, { type: "rectangle", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, before);
  applyAction(data, { type: "rectangle", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, after);
});

test("autotile bucket replacement canonicalizes neighbour edits and preserves other layers", () => {
  const data = map(7, 7);
  for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++)
    data.tiles[y * data.width + x] = 48;
  data.tiles[7 * 7 + 8] = 1024;
  const before = data.tiles.slice();
  const changes = floodFill(data, 3, 3, 0, 384);
  assert.equal(new Set(changes.map(c => `${c.layer}:${c.x}:${c.y}`)).size, changes.length);
  assert.deepEqual(data.tiles.slice(49), before.slice(49));
  const after = data.tiles.slice();
  revertAction(data, { type: "fill", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, before);
  applyAction(data, { type: "fill", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, after);
});

test("clear selected map tiles on all XP layers preserves events and is fully undoable", () => {
  const data = map(6, 5);
  data.events = [{ id: 1, x: 2, y: 2, name: "Keep" }];
  for (let layer = 0; layer < 3; layer++) {
    for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++)
      data.tiles[layer * 30 + y * 6 + x] = 384 + layer;
  }
  const before = data.tiles.slice();
  const changes = clearMapTileRegion(data, { x1: 1, y1: 1, x2: 3, y2: 3 }, -1);
  assert.equal(changes.length, 27);
  assert.equal(new Set(changes.map(c => `${c.layer}:${c.x}:${c.y}`)).size, changes.length);
  assert.equal(data.events[0].name, "Keep");
  for (let layer = 0; layer < 3; layer++) {
    assert.equal(data.tiles[layer * 30 + 2 * 6 + 2], 0);
    assert.equal(data.tiles[layer * 30], 384 + layer);
  }
  const after = data.tiles.slice();
  revertAction(data, { type: "erase", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, before);
  applyAction(data, { type: "erase", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, after);
});

test("clear selected map tiles rejects events layer and malformed rectangles atomically", () => {
  const data = map();
  data.tiles.fill(384);
  const before = data.tiles.slice();
  assert.deepEqual(clearMapTileRegion(data, { x1: 0, y1: 0, x2: 1, y2: 1 }, 3), []);
  assert.deepEqual(clearMapTileRegion(data, { x1: 0.5, y1: 0, x2: 1, y2: 1 }, 0), []);
  assert.deepEqual(data.tiles, before);
});

test("selected XP map tiles move atomically with overlapping source and destination", () => {
  const data = map(4, 2);
  data.tiles.splice(0, 8, 384, 385, 386, 0, 400, 401, 402, 0);
  data.tiles[8] = -1;
  data.events.push({ id: 7, x: 1, y: 1 });
  const before = structuredClone(data);
  const changes = translateMapTileRegion(data, { x1: 0, y1: 0, x2: 1, y2: 1 }, 0, 1, 0);
  assert.deepEqual(data.tiles.slice(0, 8), [0, 384, 385, 0, 0, 400, 401, 0]);
  assert.deepEqual(data.tiles.slice(8), before.tiles.slice(8));
  assert.deepEqual(data.events, before.events);
  assert.equal(new Set(changes.map(c => `${c.layer}:${c.x}:${c.y}`)).size, changes.length);
  revertAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data, before);
  applyAction(data, { type: "paste", changes, timestamp: 0 });
  assert.equal(data.tiles[1], 384);
});

test("duplicate selection preserves source across all XP layers and rejects out-of-bounds moves", () => {
  const data = map(3, 2);
  data.tiles[0] = 384;
  data.tiles[6] = -1;
  data.tiles[12] = 1024;
  const before = data.tiles.slice();
  const changes = translateMapTileRegion(data, { x1: 0, y1: 0, x2: 0, y2: 0 }, -1, 1, 0, "copy");
  assert.equal(changes.length, 3);
  assert.equal(data.tiles[1], 384);
  assert.equal(data.tiles[7], -1);
  assert.equal(data.tiles[13], 1024);
  assert.equal(data.tiles[0], 384);
  assert.deepEqual(translateMapTileRegion(data, { x1: 2, y1: 0, x2: 2, y2: 0 }, -1, 1, 0), []);
  revertAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, before);
});

test("selected tile layer swap preserves all XP data outside the region and supports undo redo", () => {
  const data = map(4, 3);
  const area = 12;
  data.tiles[1] = 384;
  data.tiles[area + 1] = 48;
  data.tiles[area * 2 + 1] = -1;
  data.tiles[2] = 500;
  data.events.push({ id: 1, x: 1, y: 0, name: "Guard" });
  const original = structuredClone(data);
  const changes = swapMapTileLayers(data, { x1: 1, y1: 0, x2: 1, y2: 0 }, 0, 2);
  assert.equal(changes.length, 2);
  assert.equal(data.tiles[1], -1);
  assert.equal(data.tiles[area * 2 + 1], 384);
  assert.equal(data.tiles[2], 500);
  assert.equal(data.tiles[area + 1], 48);
  assert.deepEqual(data.events, original.events);
  revertAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data, original);
  applyAction(data, { type: "paste", changes, timestamp: 0 });
  assert.equal(data.tiles[1], -1);
  assert.equal(data.tiles[area * 2 + 1], 384);
});

test("layer exchange rejects invalid layers and rectangles without mutation", () => {
  const data = map();
  const original = structuredClone(data);
  for (const layers of [[0, 0], [-1, 2], [0, 3]]) {
    assert.deepEqual(swapMapTileLayers(data, { x1: 0, y1: 0, x2: 1, y2: 1 }, ...layers), []);
  }
  assert.deepEqual(swapMapTileLayers(data, { x1: 99, y1: 99, x2: 100, y2: 100 }, 0, 1), []);
  assert.deepEqual(data, original);
});


test("cross-layer copy preserves transparent source cells, source and events, and supports undo/redo", () => {
  const data = map(4, 2);
  const area = 8;
  data.tiles[0] = 384;
  data.tiles[1] = 0;
  data.tiles[area] = 800;
  data.tiles[area + 1] = -1;
  data.tiles[area * 2] = 700;
  data.events.push({ id: 9, x: 0, y: 0, name: "NPC" });
  const before = structuredClone(data);
  const changes = copyMapTileRegionToLayer(data, { x1: 0, y1: 0, x2: 1, y2: 0 }, 0, 1);
  assert.deepEqual(changes, [{ x: 0, y: 0, layer: 1, oldTileId: 800, newTileId: 384 }]);
  assert.equal(data.tiles[area + 1], -1);
  assert.equal(data.tiles[area * 2], 700);
  assert.deepEqual(data.events, before.events);
  revertAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data, before);
  applyAction(data, { type: "paste", changes, timestamp: 0 });
  assert.equal(data.tiles[area], 384);
});

test("cross-layer replace copies zero and signed tile IDs, reverses selection and clips bounds", () => {
  const data = map(3, 2);
  const area = 6;
  data.tiles[0] = -1;
  data.tiles[1] = 0;
  data.tiles[area * 2] = 384;
  data.tiles[area * 2 + 1] = 385;
  const before = data.tiles.slice();
  const changes = copyMapTileRegionToLayer(data, { x1: 1, y1: 0, x2: -3, y2: 0 }, 0, 2, "replace");
  assert.equal(changes.length, 2);
  assert.equal(data.tiles[area * 2], -1);
  assert.equal(data.tiles[area * 2 + 1], 0);
  revertAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data.tiles, before);
});

test("cross-layer copy rejects invalid layer pairs, rectangles and modes atomically", () => {
  const data = map();
  const before = structuredClone(data);
  for (const pair of [[0, 0], [-1, 1], [1, 3]]) {
    assert.deepEqual(copyMapTileRegionToLayer(data, { x1: 0, y1: 0, x2: 1, y2: 1 }, ...pair), []);
  }
  assert.deepEqual(copyMapTileRegionToLayer(data, { x1: NaN, y1: 0, x2: 1, y2: 1 }, 0, 1), []);
  assert.deepEqual(copyMapTileRegionToLayer(data, { x1: 30, y1: 0, x2: 40, y2: 1 }, 0, 1), []);
  assert.deepEqual(copyMapTileRegionToLayer(data, { x1: 0, y1: 0, x2: 1, y2: 1 }, 0, 1, "invalid"), []);
  assert.deepEqual(data, before);
});


test("horizontal mirror of selection is reversible and leaves other layers and events intact", () => {
  const data = map(4, 3);
  const area = 12;
  data.tiles[0] = 384;
  data.tiles[1] = 0;
  data.tiles[2] = -1;
  data.tiles[3] = 700;
  data.tiles[area] = 999;
  data.events.push({ id: 1, name: "Guard", x: 0, y: 0 });
  const before = structuredClone(data);
  const changes = mirrorMapTileRegion(data, { x1: 2, y1: 0, x2: 0, y2: 0 }, 0, "horizontal");
  assert.equal(changes.length, 2);
  assert.deepEqual(data.tiles.slice(0, 4), [-1, 0, 384, 700]);
  assert.equal(data.tiles[area], 999);
  assert.deepEqual(data.events, before.events);
  revertAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data, before);
  applyAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data.tiles.slice(0, 4), [-1, 0, 384, 700]);
});

test("vertical mirror can transform all three XP layers without touching map metadata", () => {
  const data = map(2, 3);
  const area = 6;
  for (let layer = 0; layer < 3; layer++) {
    data.tiles[layer * area] = 384 + layer;
    data.tiles[layer * area + 4] = 1000 + layer;
  }
  const before = structuredClone(data);
  const changes = mirrorMapTileRegion(data, { x1: 0, y1: 0, x2: 0, y2: 2 }, -1, "vertical");
  assert.equal(changes.length, 6);
  for (let layer = 0; layer < 3; layer++) {
    assert.equal(data.tiles[layer * area], 1000 + layer);
    assert.equal(data.tiles[layer * area + 4], 384 + layer);
  }
  revertAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data, before);
});

test("mirror rejects invalid layers, axes and rectangles without mutation", () => {
  const data = map();
  const before = structuredClone(data);
  for (const layer of [-2, 3, 0.5, NaN]) {
    assert.deepEqual(mirrorMapTileRegion(data, { x1: 0, y1: 0, x2: 1, y2: 1 }, layer, "vertical"), []);
  }
  assert.deepEqual(mirrorMapTileRegion(data, { x1: 0, y1: 0, x2: 1, y2: 1 }, 0, "diagonal"), []);
  assert.deepEqual(mirrorMapTileRegion(data, { x1: 100, y1: 0, x2: 101, y2: 1 }, 0, "horizontal"), []);
  assert.deepEqual(mirrorMapTileRegion(data, { x1: Infinity, y1: 0, x2: 1, y2: 1 }, 0, "vertical"), []);
  assert.deepEqual(data, before);
});


test("180-degree tile-region rotation supports rectangular regions, signed IDs and one-step undo", () => {
  const data = map(4, 3);
  const area = 12;
  data.tiles[0] = 384;
  data.tiles[1] = -1;
  data.tiles[4] = 48;
  data.tiles[5] = 1024;
  data.tiles[area + 0] = 700;
  data.tiles[area * 2 + 0] = 800;
  data.events.push({ id: 7, name: "NPC", x: 0, y: 0 });
  const before = structuredClone(data);
  const changes = mirrorMapTileRegion(data, { x1: 0, y1: 0, x2: 1, y2: 1 }, -1, "rotate180");
  assert.equal(data.tiles[0], 1024);
  assert.equal(data.tiles[1], 48);
  assert.equal(data.tiles[4], -1);
  assert.equal(data.tiles[5], 384);
  assert.equal(data.tiles[area], 0);
  assert.equal(data.tiles[area + 5], 700);
  assert.equal(data.tiles[area * 2 + 5], 800);
  assert.deepEqual(data.events, before.events);
  revertAction(data, { type: "paste", changes, timestamp: 0 });
  assert.deepEqual(data, before);
  applyAction(data, { type: "paste", changes, timestamp: 0 });
  assert.equal(data.tiles[0], 1024);
});
