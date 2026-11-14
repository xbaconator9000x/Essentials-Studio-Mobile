import test from "node:test";
import assert from "node:assert/strict";
import {
  fillSpritePixels,
  fillMatchingSpritePixels,
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
  adjustSpriteBrightness,
  transformSpriteColors,
  shiftSpriteHue,
  simplifySpritePixels,
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
  assert.equal(fillSpritePixels(large, 1001, 1000, 0, 0, "#abcdef"), null);
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

test("sprite paste clips negative origins without shifting source pixels and remains undoable", () => {
  const data = image(2, 2, [9, 9, 9, 255]);
  const original = [...data];
  const clipboard = { width: 3, height: 3, data: image(3, 3) };
  for (let i = 0; i < 9; i++) clipboard.data.set([i + 1, 0, 0, 255], i * 4);
  const action = pasteSpriteSelection(data, 2, 2, clipboard, { x: -1, y: -1 });
  assert.equal(action?.pixels.length, 4);
  assert.deepEqual([0, 1, 2, 3].map(i => data[i * 4]), [5, 6, 8, 9]);
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], original);
  assert.equal(history.redo(data), true);
  assert.deepEqual([0, 1, 2, 3].map(i => data[i * 4]), [5, 6, 8, 9]);
});

test("sprite paste rejects nonintersecting and unsafe destinations without mutations", () => {
  const data = image(2, 2, [9, 9, 9, 255]);
  const before = [...data];
  const clipboard = { width: 2, height: 2, data: image(2, 2, [1, 2, 3, 255]) };
  for (const destination of [
    { x: -2, y: 0 }, { x: 0, y: -2 }, { x: 2, y: 0 },
    { x: 0, y: 2 }, { x: Number.MAX_SAFE_INTEGER + 1, y: 0 },
  ]) assert.equal(pasteSpriteSelection(data, 2, 2, clipboard, destination), null);
  assert.deepEqual([...data], before);
});

test("transparent-preserving clipped sprite paste does not erase destination", () => {
  const data = image(2, 1, [20, 30, 40, 255]);
  const clipboard = { width: 3, height: 1, data: new Uint8ClampedArray([
    1, 2, 3, 255, 0, 0, 0, 0, 70, 80, 90, 128,
  ]) };
  const action = pasteSpriteSelection(data, 2, 1, clipboard, { x: -1, y: 0 }, "preserve");
  assert.equal(action?.pixels.length, 1);
  assert.deepEqual([...data], [20, 30, 40, 255, 70, 80, 90, 128]);
});

test("invalid sprite transform commands never mutate pixel buffers", () => {
  const data = image(2, 2);
  data.set([255, 0, 0, 255], 0);
  data.set([0, 255, 0, 255], 4);
  const original = [...data];
  assert.equal(flipSpritePixels(data, 2, 2, "diagonal"), null);
  assert.equal(rotateSquareSpritePixels(data, 2, 2, "sideways"), null);
  assert.deepEqual([...data], original);
});

test("mirrored strokes paint pixel-exact horizontal, vertical and quadrant symmetry", () => {
  const data = image(5, 5);
  const horizontal = paintSpritePixels(data, 5, 5, 0, 1, "#ff5500", 1, false, true, false);
  assert.equal(horizontal?.pixels.length, 2);
  assert.deepEqual([0, 1, 2, 3, 4].map(x => data[(1 * 5 + x) * 4]), [255, 0, 0, 0, 255]);
  const vertical = paintSpritePixels(data, 5, 5, 2, 0, "#00aa00", 1, false, false, true);
  assert.equal(vertical?.pixels.length, 2);
  assert.deepEqual([0, 1, 2, 3, 4].map(y => data[(y * 5 + 2) * 4 + 1]), [170, 0, 0, 0, 170]);
  const quadrants = paintSpritePixels(data, 5, 5, 0, 0, "#0000ff", 1, false, true, true);
  assert.equal(quadrants?.pixels.length, 4);
  assert.deepEqual([0, 4, 20, 24].map(p => data[p * 4 + 2]), [255, 255, 255, 255]);
  const middle = paintSpritePixels(data, 5, 5, 2, 2, "#ffffff", 1, false, true, true);
  assert.equal(middle?.pixels.length, 1);
});

test("even-sized brush mirrors painted footprint exactly, including clipping", () => {
  const data = image(8, 3);
  const action = paintSpritePixels(data, 8, 3, 2, 1, "#123456", 2, false, true, false);
  assert.equal(action?.pixels.length, 8);
  const alphaRows = Array.from({ length: 3 }, (_, y) => Array.from({ length: 8 }, (_, x) => data[(y * 8 + x) * 4 + 3]));
  assert.deepEqual(alphaRows, [
    [0, 255, 255, 0, 0, 255, 255, 0],
    [0, 255, 255, 0, 0, 255, 255, 0],
    Array(8).fill(0),
  ]);
});

test("mirrored erasing is one reversible edit, leaving unmirrored pixels alone", () => {
  const data = image(5, 1, [99, 88, 77, 255]);
  const before = [...data];
  const action = paintSpritePixels(data, 5, 1, 1, 0, "#000000", 1, true, true, false);
  assert.equal(action?.pixels.length, 2);
  assert.deepEqual([0, 1, 2, 3, 4].map(x => data[x * 4 + 3]), [255, 0, 255, 0, 255]);
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], before);
  assert.equal(history.redo(data), true);
  assert.deepEqual([0, 1, 2, 3, 4].map(x => data[x * 4 + 3]), [255, 0, 255, 0, 255]);
});

test("mirroring modes reject invalid flags and never mutate malformed buffers", () => {
  const data = image(2, 2);
  const prior = [...data];
  assert.equal(paintSpritePixels(data, 2, 2, 0, 0, "#ffffff", 1, false, "yes", false), null);
  assert.equal(paintSpritePixels(data, 2, 2, 0, 0, "#ffffff", 1, false, false, null), null);
  assert.deepEqual([...data], prior);
});

test("bucket fill respects rectangular selection boundaries and exact RGBA connectivity", () => {
  const data = image(5, 3);
  const selection = { x: 1, y: 1, width: 3, height: 1 };
  const history = new SpritePixelHistory();
  const original = [...data];
  assert.equal(fillSpritePixels(data, 5, 3, 0, 1, "#abcdef", selection), null);
  const action = fillSpritePixels(data, 5, 3, 2, 1, "#abcdef", selection);
  assert.equal(action?.pixels.length, 3);
  assert.deepEqual([...data.slice(0, 5 * 4)], original.slice(0, 5 * 4));
  assert.deepEqual([...data.slice(5 * 4, 6 * 4)], [0, 0, 0, 0]);
  assert.deepEqual([...data.slice(6 * 4, 9 * 4)], Array(3).fill([171, 205, 239, 255]).flat());
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], original);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(6 * 4, 9 * 4)], Array(3).fill([171, 205, 239, 255]).flat());
});

test("selection bucket fill rejects malformed bounds without modifying image", () => {
  const data = image(4, 4);
  const original = [...data];
  for (const area of [
    { x: -1, y: 0, width: 2, height: 2 },
    { x: 3, y: 3, width: 2, height: 2 },
    { x: 0, y: 0, width: 0, height: 1 },
  ]) {
    assert.equal(fillSpritePixels(data, 4, 4, 1, 1, "#ffffff", area), null);
  }
  assert.deepEqual([...data], original);
});

test("brush and eraser clip to selection including mirrored pixels, preserving undo", () => {
  const data = image(6, 4);
  const area = { x: 1, y: 1, width: 2, height: 2 };
  const history = new SpritePixelHistory();
  const original = [...data];
  const paint = paintSpritePixels(data, 6, 4, 2, 1, "#ff0044", 3, false, true, true, area);
  assert.ok(paint);
  assert.ok(paint.pixels.length > 0);
  for (const pixel of paint.pixels) {
    assert.ok(pixel % 6 >= area.x && pixel % 6 < area.x + area.width);
    assert.ok(Math.floor(pixel / 6) >= area.y && Math.floor(pixel / 6) < area.y + area.height);
  }
  assert.equal(history.push(paint), true);
  const painted = [...data];
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], original);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data], painted);
  const erase = paintSpritePixels(data, 6, 4, 2, 1, "#000000", 3, true, true, true, area);
  assert.ok(erase);
  assert.equal(history.push(erase), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], painted);
});

test("invalid sprite brush selection is rejected atomically", () => {
  const data = image(3, 3);
  assert.equal(paintSpritePixels(data, 3, 3, 1, 1, "#ffffff", 1, false, false, false,
    { x: 2, y: 2, width: 2, height: 2 }), null);
  assert.deepEqual([...data], [...image(3, 3)]);
});

test("shade-tolerant recolor preserves tonal offsets, alpha, selection and undo", () => {
  const data = new Uint8ClampedArray([
    100, 100, 100, 255, 110, 95, 105, 128,
    180, 180, 180, 255, 105, 105, 105, 0,
  ]);
  const original = [...data];
  const action = replaceSpriteColor(data, 4, 1, "#646464", "#326496",
    { x: 0, y: 0, width: 3, height: 1 }, 12);
  assert.equal(action?.pixels.length, 2);
  assert.deepEqual([...data.slice(0, 8)], [50, 100, 150, 255, 60, 95, 155, 128]);
  assert.deepEqual([...data.slice(8)], original.slice(8));
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], original);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(0, 8)], [50, 100, 150, 255, 60, 95, 155, 128]);
});

test("recolor tolerance rejects invalid values and keeps exact-match default", () => {
  const data = image(2, 1, [100, 100, 100, 255]);
  const original = [...data];
  assert.equal(replaceSpriteColor(data, 2, 1, "#646464", "#ffffff", null, -1), null);
  assert.equal(replaceSpriteColor(data, 2, 1, "#646464", "#ffffff", null, 256), null);
  assert.deepEqual([...data], original);
  assert.equal(replaceSpriteColor(data, 2, 1, "#646464", "#ffffff")?.pixels.length, 2);
});


test("brightness adjusts selected opaque and translucent RGB, preserves alpha and supports undo/redo", () => {
  const data = image(3, 1);
  data.set([250, 3, 100, 255], 0);
  data.set([100, 110, 120, 128], 4);
  data.set([4, 5, 6, 0], 8);
  const before = [...data];
  const history = new SpritePixelHistory();
  const action = adjustSpriteBrightness(data, 3, 1, 16, { x: 0, y: 0, width: 2, height: 1 });
  assert.equal(action?.pixels.length, 2);
  assert.deepEqual([...data.slice(0, 8)], [255, 19, 116, 255, 116, 126, 136, 128]);
  assert.deepEqual([...data.slice(8)], [4, 5, 6, 0]);
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], before);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(4, 8)], [116, 126, 136, 128]);
});

test("darken clamps channels, ignores fully transparent pixels and rejects invalid requests atomically", () => {
  const data = image(2, 1);
  data.set([10, 20, 30, 64], 0);
  data.set([10, 20, 30, 0], 4);
  const action = adjustSpriteBrightness(data, 2, 1, -16);
  assert.equal(action?.pixels.length, 1);
  assert.deepEqual([...data], [0, 4, 14, 64, 10, 20, 30, 0]);
  const before = [...data];
  for (const delta of [0, NaN, 1.5, -256, 256]) {
    assert.equal(adjustSpriteBrightness(data, 2, 1, delta), null);
  }
  assert.equal(adjustSpriteBrightness(data, 2, 1, 16, { x: 1, y: 0, width: 2, height: 1 }), null);
  assert.deepEqual([...data], before);
});


test("grayscale and invert preserve alpha and untouched selection pixels with reversible actions", () => {
  const data = image(3, 1);
  data.set([255, 0, 0, 128, 0, 255, 0, 255, 15, 30, 45, 0]);
  const original = data.slice();
  const history = new SpritePixelHistory();
  const gray = transformSpriteColors(data, 3, 1, "grayscale", { x: 0, y: 0, width: 1, height: 1 });
  assert.ok(gray);
  assert.deepEqual(Array.from(data.slice(0, 4)), [54, 54, 54, 128]);
  assert.deepEqual(Array.from(data.slice(4)), Array.from(original.slice(4)));
  assert.equal(history.push(gray), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual(data, original);
  assert.equal(history.redo(data), true);
  const inverted = transformSpriteColors(data, 3, 1, "invert");
  assert.ok(inverted);
  assert.deepEqual(Array.from(data.slice(0, 4)), [201, 201, 201, 128]);
  assert.deepEqual(Array.from(data.slice(8, 12)), [15, 30, 45, 0]);
});

test("contrast transformations clamp channels, preserve transparency and reject invalid bulk edits", () => {
  const data = image(2, 1);
  data.set([32, 128, 224, 100, 10, 20, 30, 0]);
  const original = data.slice();
  const action = transformSpriteColors(data, 2, 1, "contrast-up");
  assert.ok(action);
  assert.deepEqual(Array.from(data.slice(0, 4)), [13, 128, 243, 100]);
  assert.deepEqual(data.slice(4), original.slice(4));
  assert.equal(transformSpriteColors(data, 2, 1, "not-an-operation"), null);
  assert.equal(transformSpriteColors(data, 2, 1, "invert", { x: 0, y: 0, width: 3, height: 1 }), null);
  assert.equal(transformSpriteColors(data, 0, 1, "invert"), null);
  assert.deepEqual(data.slice(4), original.slice(4));
  const down = transformSpriteColors(data, 2, 1, "contrast-down");
  assert.ok(down);
  assert.deepEqual(Array.from(data.slice(0, 4)), [36, 128, 220, 100]);
});


test("flood fill over one million pixels is rejected atomically without throwing", () => {
  const width = 1001, height = 1000;
  const data = image(width, height, [12, 34, 56, 255]);
  const before = data.slice();
  assert.doesNotThrow(() => {
    assert.equal(fillSpritePixels(data, width, height, 0, 0, "#abcdef"), null);
  });
  assert.deepEqual(data, before);
});

test("flood fill at one million pixels succeeds and remains undoable", () => {
  const width = 1000, height = 1000;
  const data = image(width, height, [12, 34, 56, 255]);
  const action = fillSpritePixels(data, width, height, 0, 0, "#abcdef");
  assert.ok(action);
  assert.equal(action.pixels.length, 1_000_000);
  assert.deepEqual([...data.slice(0, 4)], [171, 205, 239, 255]);
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data.slice(-4)], [12, 34, 56, 255]);
});


test("oversized-fill rejection does not poison subsequent small edits", () => {
  const width = 1001, height = 1000;
  const data = image(width, height, [12, 34, 56, 255]);
  assert.equal(fillSpritePixels(data, width, height, 0, 0, "#abcdef"), null);
  // Make one isolated transparent pixel, then fill only that pixel.
  data.set([0, 0, 0, 0], 0);
  const action = fillSpritePixels(data, width, height, 0, 0, "#abcdef");
  assert.ok(action);
  assert.equal(action.pixels.length, 1);
  assert.deepEqual([...data.slice(0, 4)], [171, 205, 239, 255]);
  assert.deepEqual([...data.slice(4, 8)], [12, 34, 56, 255]);
});


test("flood fill at image edges and selection borders does not escape or abort traversal", () => {
  const data = image(5, 4, [10, 20, 30, 255]);
  const original = data.slice();
  const action = fillSpritePixels(data, 5, 4, 0, 0, "#abcdef",
    { x: 0, y: 0, width: 3, height: 2 });
  assert.ok(action);
  assert.equal(action.pixels.length, 6);
  assert.deepEqual([...data.slice(0, 4)], [171, 205, 239, 255]);
  assert.deepEqual(data.slice((2 * 5 + 0) * 4, (2 * 5 + 1) * 4), original.slice((2 * 5 + 0) * 4, (2 * 5 + 1) * 4));
  assert.deepEqual(data.slice((0 * 5 + 3) * 4, (0 * 5 + 4) * 4), original.slice((0 * 5 + 3) * 4, (0 * 5 + 4) * 4));
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual(data, original);
});


test("match fill changes disconnected equal RGBA islands but not distinct alpha or selection exterior", () => {
  const data = image(4, 2, [5, 6, 7, 255]);
  data.set([9, 9, 9, 255], 4);
  data.set([5, 6, 7, 128], 8);
  const original = data.slice();
  const selection = { x: 0, y: 0, width: 3, height: 2 };
  const action = fillMatchingSpritePixels(data, 4, 2, 0, 0, "#abcdef", selection);
  assert.equal(action?.pixels.length, 4);
  assert.deepEqual([...data.slice(0, 4)], [171, 205, 239, 255]);
  assert.deepEqual([...data.slice(4, 8)], [9, 9, 9, 255]);
  assert.deepEqual([...data.slice(8, 12)], [5, 6, 7, 128]);
  assert.deepEqual([...data.slice(12, 16)], [5, 6, 7, 255]);
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual(data, original);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(0, 4)], [171, 205, 239, 255]);
});

test("match fill rejects oversized disconnected sets without partial writes", () => {
  const data = image(1001, 1000, [1, 2, 3, 255]);
  const original = data.slice();
  assert.equal(fillMatchingSpritePixels(data, 1001, 1000, 0, 0, "#abcdef"), null);
  assert.deepEqual(data, original);
  assert.equal(fillMatchingSpritePixels(data, 1001, 1000, -1, 0, "#abcdef"), null);
  assert.equal(fillMatchingSpritePixels(data, 1001, 1000, 0, 0, "invalid"), null);
});


test("hue shift preserves alpha, transparent pixels, neutral shades and selection boundaries", () => {
  const data = image(4, 1);
  data.set([255, 0, 0, 255], 0);
  data.set([255, 0, 0, 128], 4);
  data.set([123, 45, 67, 0], 8);
  data.set([80, 80, 80, 255], 12);
  const original = data.slice();
  const action = shiftSpriteHue(data, 4, 1, 120, { x: 0, y: 0, width: 3, height: 1 });
  assert.equal(action?.pixels.length, 2);
  assert.deepEqual([...data.slice(0, 4)], [0, 255, 0, 255]);
  assert.deepEqual([...data.slice(4, 8)], [0, 255, 0, 128]);
  assert.deepEqual([...data.slice(8)], [...original.slice(8)]);
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual(data, original);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(0, 4)], [0, 255, 0, 255]);
});

test("hue shift rejects invalid rotations and oversized edits without mutation", () => {
  const data = image(1001, 1000, [255, 0, 0, 255]);
  const original = data.slice();
  for (const angle of [0, 360, 361, 0.5, NaN])
    assert.equal(shiftSpriteHue(data, 1001, 1000, angle), null);
  assert.equal(shiftSpriteHue(data, 1001, 1000, 30), null);
  assert.deepEqual(data, original);
  assert.equal(shiftSpriteHue(data, 1001, 1000, 30, { x: 0, y: 0, width: 1, height: 1 })?.pixels.length, 1);
});

test("posterize respects selection, alpha, transparent RGB and reversible history", () => {
  const data = image(3, 1);
  data.set([100, 150, 200, 123], 0);
  data.set([77, 88, 99, 0], 4);
  data.set([100, 150, 200, 255], 8);
  const original = [...data];
  const action = simplifySpritePixels(data, 3, 1, "posterize", 2, { x: 0, y: 0, width: 2, height: 1 });
  assert.equal(action?.pixels.length, 1);
  assert.deepEqual([...data.slice(0, 4)], [0, 255, 255, 123]);
  assert.deepEqual([...data.slice(4, 8)], [77, 88, 99, 0]);
  assert.deepEqual([...data.slice(8, 12)], original.slice(8));
  const history = new SpritePixelHistory();
  assert.equal(history.push(action), true);
  assert.equal(history.undo(data), true);
  assert.deepEqual([...data], original);
  assert.equal(history.redo(data), true);
  assert.deepEqual([...data.slice(0, 4)], [0, 255, 255, 123]);
});

test("alpha threshold is bounded, preserves transparent RGB, and rejects invalid edits atomically", () => {
  const data = image(4, 1);
  data.set([11, 22, 33, 0], 0);
  data.set([44, 55, 66, 127], 4);
  data.set([77, 88, 99, 128], 8);
  data.set([100, 110, 120, 255], 12);
  const action = simplifySpritePixels(data, 4, 1, "alpha-threshold", 128);
  assert.equal(action?.pixels.length, 2);
  assert.deepEqual([...data.slice(0, 4)], [11, 22, 33, 0]);
  assert.deepEqual([...data.slice(4, 8)], [44, 55, 66, 0]);
  assert.deepEqual([...data.slice(8, 12)], [77, 88, 99, 255]);
  const snapshot = [...data];
  for (const [op, value] of [["posterize", 1], ["posterize", 17], ["alpha-threshold", -1], ["alpha-threshold", 256], ["unknown", 2]]) {
    assert.equal(simplifySpritePixels(data, 4, 1, op, value), null);
    assert.deepEqual([...data], snapshot);
  }
  assert.equal(simplifySpritePixels(data, 4, 1, "posterize", 4, { x: 4, y: 0, width: 1, height: 1 }), null);
  assert.deepEqual([...data], snapshot);
  assert.equal(simplifySpritePixels(image(1001, 1000, [10, 20, 30, 255]), 1001, 1000, "posterize", 4), null);
});
