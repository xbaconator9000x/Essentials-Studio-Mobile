import test from "node:test";
import assert from "node:assert/strict";
import {
  fitSpriteViewport,
  rasterizeSpriteLine,
  spritePixelAt,
  zoomSpriteViewport,
} from "../src/services/spriteEditorGeometry.ts";

test("sprite fit centers an integer zoom and respects the maximum scale", () => {
  assert.deepEqual(fitSpriteViewport(16, 8, 320, 200), {
    zoom: 16,
    offsetX: 32,
    offsetY: 36,
  });
  assert.deepEqual(fitSpriteViewport(100, 50, 180, 120), {
    zoom: 1,
    offsetX: 40,
    offsetY: 35,
  });
  assert.deepEqual(fitSpriteViewport(16, 8, 320, 200, 8), {
    zoom: 8,
    offsetX: 96,
    offsetY: 68,
  });
});

test("sprite fit returns a safe origin for zero-sized viewports and invalid image dimensions", () => {
  assert.deepEqual(fitSpriteViewport(16, 8, 0, 0), {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  assert.deepEqual(fitSpriteViewport(0, 8, 320, 200), {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  assert.deepEqual(fitSpriteViewport(Number.NaN, 8, 320, 200), {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
});

test("sprite brush interpolation covers fast strokes in either direction", () => {
  assert.deepEqual(rasterizeSpriteLine({ x: 0, y: 0 }, { x: 4, y: 2 }), [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 2 },
    { x: 4, y: 2 },
  ]);
  assert.deepEqual(rasterizeSpriteLine({ x: 4, y: 2 }, { x: 0, y: 0 }), [
    { x: 4, y: 2 },
    { x: 3, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.deepEqual(rasterizeSpriteLine({ x: 2, y: 3 }, { x: 2, y: 3 }), [
    { x: 2, y: 3 },
  ]);
  assert.deepEqual(rasterizeSpriteLine({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }), []);
});

test("sprite brush coordinates respect zoom, pan, and image bounds", () => {
  const viewport = { zoom: 4, offsetX: 12, offsetY: -8 };
  assert.deepEqual(spritePixelAt(20, 1, viewport, 8, 8), { x: 2, y: 2 });
  assert.equal(spritePixelAt(11, 1, viewport, 8, 8), null);
  assert.equal(spritePixelAt(48, 1, viewport, 8, 8), null);
});

test("pinch zoom retains the pixel under the moving gesture center", () => {
  const start = { x: 40, y: 32 };
  const next = { x: 56, y: 48 };
  const viewport = { zoom: 2, offsetX: 8, offsetY: -4 };
  const world = {
    x: (start.x - viewport.offsetX) / viewport.zoom,
    y: (start.y - viewport.offsetY) / viewport.zoom,
  };
  const zoomed = zoomSpriteViewport(viewport, start, next, 2);
  assert.equal((next.x - zoomed.offsetX) / zoomed.zoom, world.x);
  assert.equal((next.y - zoomed.offsetY) / zoomed.zoom, world.y);
  assert.equal(zoomSpriteViewport(viewport, start, next, 100).zoom, 32);
});
