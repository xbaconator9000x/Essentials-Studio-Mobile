import test from "node:test";
import assert from "node:assert/strict";
import {
  fillSpritePixels,
  paintSpritePixels,
  spriteColorAt,
  normalizeSpriteSelection,
  moveSpriteSelection,
  copySpriteSelection,
  clearSpriteSelection,
  pasteSpriteSelection,
  moveSpritePixels,
  SpritePixelHistory,
  flipSpritePixels,
  rotateSquareSpritePixels,
  extractSpritePalette,
  replaceSpriteColor,
} from "../src/services/spriteEditorPixels.ts";

function image(width, height, color = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) data.set(color, pixel * 4);
  return data;
}

test("brush clips to the image, preserves dimensions, and eraser restores transparency", () => {
  const data = image(2, 2);
  const action = paintSpritePixels(data, 2, 2, 0, 0, "#ff0080");
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 128, 255]);
  assert.equal(spriteColorAt(data, 2, 2, 0, 0), "#ff0080");
  assert.equal(paintSpritePixels(data, 2, 2, -1, 0, "#ffffff"), null);
  const erase = paintSpritePixels(data, 2, 2, 0, 0, "#ffffff", 1, true);
  assert.deepEqual([...data.slice(0, 4)], [0, 0, 0, 0]);
  assert.equal(action?.pixels.length, 1);
  assert.equal(erase?.pixels.length, 1);
  assert.equal(data.length, 16);
});

test("flood fill updates only the four-connected region and rejects oversized regions atomically", () => {
  const data = image(3, 3);
  data.set([1, 2, 3, 255], 4 * 4);
  const action = fillSpritePixels(data, 3, 3, 0, 0, "#123456");
  assert.equal(action?.pixels.length, 8);
  assert.deepEqual([...data.slice(16, 20)], [1, 2, 3, 255]);

  const large = image(1001, 1000);
  assert.throws(() => fillSpritePixels(large, 1001, 1000, 0, 0, "#abcdef"), /one-million-pixel/);
  assert.deepEqual([...large.slice(0, 4)], [0, 0, 0, 0]);
});

test("sprite history groups a stroke and supports undo, redo, and cancellation", () => {
  const data = image(2, 1);
  const history = new SpritePixelHistory();
  history.begin();
  const first = paintSpritePixels(data, 2, 1, 0, 0, "#ff0000");
  const second = paintSpritePixels(data, 2, 1, 1, 0, "#00ff00");
  history.record(first);
  history.record(second);
  assert.equal(history.commit(), true);
  assert.equal(history.canUndo(), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], [...image(2, 1)]);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255]);

  history.begin();
  const pending = paintSpritePixels(data, 2, 1, 0, 0, "#0000ff");
  history.record(pending);
  assert.equal(history.cancel(data), true);
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255]);
});

test("sprite history stores flood-fill actions directly and supports undo/redo", () => {
  const data = image(3, 3);
  const history = new SpritePixelHistory();
  const action = fillSpritePixels(data, 3, 3, 1, 1, "#123456");

  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], [...image(3, 3)]);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(16, 20)], [18, 52, 86, 255]);
});

test("rectangular sprite selection normalizes drag direction and clips at image edges", () => {
  assert.deepEqual(
    normalizeSpriteSelection({ x: 3, y: 2 }, { x: -4, y: 9 }, 4, 3),
    { x: 0, y: 2, width: 4, height: 1 },
  );
  assert.deepEqual(
    normalizeSpriteSelection({ x: 3, y: 2 }, { x: 1, y: 0 }, 4, 3),
    { x: 1, y: 0, width: 3, height: 3 },
  );
  assert.equal(normalizeSpriteSelection({ x: 0.5, y: 0 }, { x: 1, y: 1 }, 4, 3), null);
});

test("sprite selection copies, cuts, pastes with alpha, and participates in undo/redo", () => {
  const data = image(3, 2);
  data.set([255, 0, 0, 255], 0);
  data.set([0, 255, 0, 255], 4);
  data.set([0, 0, 255, 255], 8);
  const selection = { x: 0, y: 0, width: 2, height: 1 };
  const copied = copySpriteSelection(data, 3, 2, selection);
  assert.deepEqual([...copied.data], [255, 0, 0, 255, 0, 255, 0, 255]);

  const history = new SpritePixelHistory();
  const cut = clearSpriteSelection(data, 3, 2, selection);
  assert.equal(cut.pixels.length, 2);
  history.push(cut);
  assert.deepEqual([...data.slice(0, 8)], [...image(2, 1)]);

  const paste = pasteSpriteSelection(data, 3, 2, copied, { x: 2, y: 1 });
  assert.equal(paste.pixels.length, 1);
  history.push(paste);
  assert.deepEqual([...data.slice(20, 24)], [255, 0, 0, 255]);

  assert.equal(history.undo(data), true);
  assert.deepEqual([...data.slice(12, 24)], [...image(3, 1)]);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data.slice(0, 8)], [255, 0, 0, 255, 0, 255, 0, 255]);
  assert.equal(history.redo(data), true);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(20, 24)], [255, 0, 0, 255]);
});

test("pasting transparent sprite pixels clears destination pixels and is undoable", () => {
  const data = image(2, 1, [1, 2, 3, 255]);
  const clipboard = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 0, 9, 8, 7, 255]),
  };
  const action = pasteSpriteSelection(data, 2, 1, clipboard, { x: 0, y: 0 });
  assert.equal(action.pixels.length, 2);
  assert.deepEqual([...data], [...clipboard.data]);
  const history = new SpritePixelHistory();
  history.push(action);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], [...image(2, 1, [1, 2, 3, 255])]);
});

test("selection operations reject invalid buffers and clipboard dimensions", () => {
  const data = image(2, 2);
  assert.equal(copySpriteSelection(data, 2, 2, { x: 1, y: 1, width: 2, height: 1 }), null);
  assert.equal(clearSpriteSelection(data, 2, 2, { x: -1, y: 0, width: 1, height: 1 }), null);
  assert.equal(pasteSpriteSelection(data, 2, 2, {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(3),
  }, { x: 0, y: 0 }), null);
  const large = image(1001, 1000);
  assert.equal(copySpriteSelection(large, 1001, 1000, {
    x: 0, y: 0, width: 1001, height: 1000,
  }), null);
  assert.equal(clearSpriteSelection(large, 1001, 1000, {
    x: 0, y: 0, width: 1001, height: 1000,
  }), null);
});

test("sprite flips preserve alpha, dimensions and pixels outside selection, with undo", () => {
  const data = new Uint8ClampedArray([1,2,3,255, 4,5,6,128, 7,8,9,0, 10,11,12,255, 13,14,15,255, 16,17,18,255]);
  const original = [...data];
  const history = new SpritePixelHistory();
  const action = flipSpritePixels(data, 3, 2, "horizontal", {x:0,y:0,width:2,height:2});
  assert.equal(history.push(action), true);
  assert.deepEqual([...data.slice(0,12)], [4,5,6,128,1,2,3,255,7,8,9,0]);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], original);
  assert.equal(history.redo(data), true);
  assert.ok(flipSpritePixels(data, 3, 2, "vertical"));
  assert.deepEqual([...data.slice(0,4)], [13,14,15,255]);
});

test("palette extraction and exact recolor ignore invisible pixels and preserve partial alpha", () => {
  const data = new Uint8ClampedArray([255,0,0,255, 255,0,0,64, 0,255,0,255, 255,0,0,0]);
  assert.deepEqual(extractSpritePalette(data, 4, 1), ["#ff0000", "#00ff00"]);
  const history = new SpritePixelHistory();
  assert.equal(history.push(replaceSpriteColor(data, 4, 1, "#ff0000", "#123456", {x:1,y:0,width:3,height:1})), true);
  assert.deepEqual([...data], [255,0,0,255,18,52,86,64,0,255,0,255,255,0,0,0]);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data.slice(4,8)], [255,0,0,64]);
  assert.equal(replaceSpriteColor(data, 4, 1, "#ff0000", "#ff0000"), null);
});

test("rotate 180 degrees preserves exact RGBA pixels and is one undoable operation", () => {
  const data = image(3, 2);
  const colors = [[1, 2, 3, 255], [4, 5, 6, 128], [7, 8, 9, 0],
    [10, 11, 12, 255], [13, 14, 15, 255], [16, 17, 18, 64]];
  colors.forEach((color, i) => data.set(color, i * 4));
  const before = [...data];
  const action = flipSpritePixels(data, 3, 2, "rotate180");
  assert.equal(action?.pixels.length, 6);
  const expected = colors.slice().reverse().flat();
  assert.deepEqual([...data], expected);
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], before);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data], expected);
});

test("rotate 180 degrees affects only selected pixels", () => {
  const data = image(3, 2);
  for (let i = 0; i < 6; i++) data.set([i + 1, 0, 0, 255], i * 4);
  const action = flipSpritePixels(data, 3, 2, "rotate180", { x: 1, y: 0, width: 2, height: 2 });
  assert.ok(action);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => data[i * 4]), [1, 6, 5, 4, 3, 2]);
});

test("90-degree square rotations preserve RGBA, selection bounds, and undo", () => {
  const data = image(4, 3);
  const values = Array.from({ length: 12 }, (_, i) => [i + 1, i, 255 - i, i * 20]);
  values.forEach((color, i) => data.set(color, i * 4));
  const before = [...data];
  const square = { x: 1, y: 0, width: 2, height: 2 };
  const action = rotateSquareSpritePixels(data, 4, 3, "clockwise", square);
  assert.ok(action);
  const expected = values.map((color) => [...color]);
  expected[1] = values[5];
  expected[2] = values[1];
  expected[5] = values[6];
  expected[6] = values[2];
  assert.deepEqual([...data], expected.flat());
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], before);
  assert.equal(history.redo(data), true);
  const reverse = rotateSquareSpritePixels(data, 4, 3, "counterclockwise", square);
  assert.ok(reverse);
  assert.deepEqual([...data], before);
});

test("90-degree rotation rejects rectangular regions without modifying pixels", () => {
  const data = image(3, 2, [10, 20, 30, 255]);
  const before = [...data];
  assert.equal(rotateSquareSpritePixels(data, 3, 2, "clockwise"), null);
  assert.equal(rotateSquareSpritePixels(data, 3, 2, "counterclockwise", { x: 0, y: 0, width: 2, height: 1 }), null);
  assert.deepEqual([...data], before);
});

test("touch selection nudges preserve rectangle size and clamp all image edges", () => {
  const start = { x: 2, y: 1, width: 3, height: 2 };
  assert.deepEqual(moveSpriteSelection(start, 1, 1, 6, 4), { x: 3, y: 2, width: 3, height: 2 });
  assert.deepEqual(moveSpriteSelection(start, -100, -100, 6, 4), { x: 0, y: 0, width: 3, height: 2 });
  assert.deepEqual(moveSpriteSelection(start, 100, 100, 6, 4), { x: 3, y: 2, width: 3, height: 2 });
  assert.deepEqual(start, { x: 2, y: 1, width: 3, height: 2 });
  assert.equal(moveSpriteSelection(start, 1.5, 0, 6, 4), null);
  assert.equal(moveSpriteSelection({ ...start, width: 7 }, 1, 0, 6, 4), null);
});

test("transparent-preserving paste overlays visible RGBA pixels without erasing background", () => {
  const data = image(3, 1, [12, 34, 56, 255]);
  const clipboard = { width: 2, height: 1, data: new Uint8ClampedArray([
    250, 0, 0, 128, 0, 0, 0, 0,
  ]) };
  const action = pasteSpriteSelection(data, 3, 1, clipboard, { x: 1, y: 0 }, "preserve");
  assert.equal(action?.pixels.length, 1);
  assert.deepEqual([...data.slice(0, 4)], [12, 34, 56, 255]);
  assert.deepEqual([...data.slice(4, 8)], [250, 0, 0, 128]);
  assert.deepEqual([...data.slice(8, 12)], [12, 34, 56, 255]);
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], [...image(3, 1, [12, 34, 56, 255])]);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(4, 8)], [250, 0, 0, 128]);
});

test("legacy replacement paste still clears destinations beneath transparent clipboard pixels", () => {
  const data = image(2, 1, [12, 34, 56, 255]);
  const clipboard = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) };
  assert.ok(pasteSpriteSelection(data, 2, 1, clipboard, { x: 0, y: 0 }));
  assert.deepEqual([...data.slice(0, 4)], [0, 0, 0, 0]);
  assert.equal(pasteSpriteSelection(data, 2, 1, clipboard, { x: 1, y: 0 }, "invalid"), null);
  assert.deepEqual([...data.slice(4, 8)], [12, 34, 56, 255]);
});

test("moving sprite pixels handles overlap atomically and restores original on undo", () => {
  const data = image(4, 1);
  for (let i = 0; i < 4; i++) data.set([i + 1, 0, 0, 255], i * 4);
  const before = [...data];
  const action = moveSpritePixels(data, 4, 1, { x: 0, y: 0, width: 2, height: 1 }, 1, 0);
  assert.ok(action);
  assert.deepEqual([0, 1, 2, 3].map(i => data[i * 4]), [0, 1, 2, 4]);
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], before);
  assert.equal(history.redo(data), true);
  assert.deepEqual([0, 1, 2, 3].map(i => data[i * 4]), [0, 1, 2, 4]);
});

test("moving pixels preserves alpha and rejects out-of-bounds edits without mutation", () => {
  const data = image(3, 2);
  data.set([20, 40, 60, 128], 0);
  const before = [...data];
  assert.equal(moveSpritePixels(data, 3, 2, { x: 0, y: 0, width: 1, height: 1 }, -1, 0), null);
  assert.equal(moveSpritePixels(data, 3, 2, { x: 0, y: 0, width: 1, height: 1 }, 0, 0), null);
  assert.deepEqual([...data], before);
  assert.ok(moveSpritePixels(data, 3, 2, { x: 0, y: 0, width: 1, height: 1 }, 2, 1));
  assert.deepEqual([...data.slice(20, 24)], [20, 40, 60, 128]);
  assert.deepEqual([...data.slice(0, 4)], [0, 0, 0, 0]);
});

test("duplicate sprite pixels preserves source, copies exact alpha, and supports undo", () => {
  const data = image(4, 1);
  data.set([25, 50, 75, 128], 0);
  data.set([100, 125, 150, 255], 4);
  const original = [...data];
  const area = { x: 0, y: 0, width: 2, height: 1 };
  const action = moveSpritePixels(data, 4, 1, area, 2, 0, "duplicate");
  assert.ok(action);
  assert.deepEqual([...data.slice(0, 8)], original.slice(0, 8));
  assert.deepEqual([...data.slice(8)], original.slice(0, 8));
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], original);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(8)], original.slice(0, 8));
});

test("duplicate sprite pixels snapshots overlap and rejects out-of-bounds or unknown mode", () => {
  const data = image(3, 1);
  [1, 2, 3].forEach((v, i) => data.set([v, 0, 0, 255], i * 4));
  const area = { x: 0, y: 0, width: 2, height: 1 };
  assert.ok(moveSpritePixels(data, 3, 1, area, 1, 0, "duplicate"));
  assert.deepEqual([data[0], data[4], data[8]], [1, 1, 2]);
  const before = [...data];
  assert.equal(moveSpritePixels(data, 3, 1, area, 2, 0, "duplicate"), null);
  assert.equal(moveSpritePixels(data, 3, 1, area, 1, 0, "unknown"), null);
  assert.deepEqual([...data], before);
});
