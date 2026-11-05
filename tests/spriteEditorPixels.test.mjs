import test from "node:test";
import assert from "node:assert/strict";
import {
  fillSpritePixels,
  paintSpritePixels,
  spriteColorAt,
  SpritePixelHistory,
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
