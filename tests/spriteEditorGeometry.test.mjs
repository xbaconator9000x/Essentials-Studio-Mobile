import test from "node:test";
import assert from "node:assert/strict";
import {
  fitSpriteViewport,
  rasterizeSpriteLine,
  spritePixelAt,
  zoomSpriteTraceTransform,
  zoomSpriteViewport,
  setSpriteViewportZoom,
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

test("trace pinch scales around the moving gesture center and preserves separate offsets", () => {
  const start = { x: 100, y: 100 };
  const next = { x: 110, y: 100 };
  const transform = zoomSpriteTraceTransform(
    { scale: 100, offsetX: 0, offsetY: 0 },
    { zoom: 16, offsetX: 68, offsetY: 68 },
    4,
    4,
    start,
    next,
    1.5,
  );

  assert.equal(transform.scale, 150);
  assert.equal(transform.offsetX, 15.625);
  assert.equal(transform.offsetY, 0);
  const oldLeft = 68;
  const oldWidth = 64;
  const newLeft = 68 + (64 - 96) / 2 + 64 * transform.offsetX / 100;
  assert.equal(newLeft + 96 / 2, next.x + (oldLeft + oldWidth / 2 - start.x) * 1.5);
});

test("trace pinch clamps scale and offsets and ignores invalid gestures", () => {
  const viewport = { zoom: 4, offsetX: 0, offsetY: 0 };
  const center = { x: 0, y: 0 };
  assert.deepEqual(zoomSpriteTraceTransform(
    { scale: 100, offsetX: 0, offsetY: 0 },
    viewport,
    4,
    4,
    center,
    { x: 1000, y: 1000 },
    10,
  ), { scale: 200, offsetX: 100, offsetY: 100 });
  const transform = { scale: 100, offsetX: 4, offsetY: -5 };
  assert.equal(zoomSpriteTraceTransform(transform, viewport, 4, 4, center, center, 0), transform);
});

test("invalid pointer gestures cannot allocate unbounded sprite strokes", () => {
  assert.deepEqual(rasterizeSpriteLine({ x: 0, y: 0 }, { x: 1_000_000, y: 0 }), []);
  assert.deepEqual(rasterizeSpriteLine({ x: NaN, y: 0 }, { x: 1, y: 1 }), []);
  assert.deepEqual(rasterizeSpriteLine({ x: 0.5, y: 0 }, { x: 1, y: 1 }), []);
  assert.equal(rasterizeSpriteLine({ x: 0, y: 0 }, { x: 3, y: 0 }).length, 4);
});

test("invalid pinch and coordinate inputs leave viewport unchanged", () => {
  const viewport = { zoom: 2, offsetX: 4, offsetY: 8 };
  const center = { x: 20, y: 30 };
  for (const scale of [0, -1, NaN, Infinity]) {
    assert.equal(zoomSpriteViewport(viewport, center, center, scale), viewport);
  }
  assert.equal(zoomSpriteViewport(viewport, { x: Infinity, y: 0 }, center, 2), viewport);
  assert.equal(spritePixelAt(NaN, 10, viewport, 16, 16), null);
  assert.equal(spritePixelAt(10, 10, { ...viewport, offsetX: Infinity }, 16, 16), null);
});

test("exact zoom retains the anchored pixel and clamps to 1–32×", () => {
  const viewport = { zoom: 4, offsetX: 12, offsetY: -8 };
  const anchor = { x: 100, y: 80 };
  const worldX = (anchor.x - viewport.offsetX) / viewport.zoom;
  const worldY = (anchor.y - viewport.offsetY) / viewport.zoom;
  for (const level of [1, 3, 7, 16, 32]) {
    const result = setSpriteViewportZoom(viewport, level, anchor);
    assert.equal(result.zoom, level);
    assert.equal((anchor.x - result.offsetX) / result.zoom, worldX);
    assert.equal((anchor.y - result.offsetY) / result.zoom, worldY);
  }
  assert.equal(setSpriteViewportZoom(viewport, 100, anchor).zoom, 32);
  assert.equal(setSpriteViewportZoom(viewport, 0.25, anchor).zoom, 1);
  assert.equal(setSpriteViewportZoom(viewport, NaN, anchor), viewport);
  assert.equal(setSpriteViewportZoom(viewport, 4, { x: Infinity, y: 0 }), viewport);
});
