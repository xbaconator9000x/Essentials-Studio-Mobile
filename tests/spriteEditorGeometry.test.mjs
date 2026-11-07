import test from "node:test";
import assert from "node:assert/strict";
import {
  spritePixelAt,
  zoomSpriteViewport,
} from "../src/services/spriteEditorGeometry.ts";

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
