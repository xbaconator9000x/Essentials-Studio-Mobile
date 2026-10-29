import test from "node:test";
import assert from "node:assert/strict";
import { DecodedImageCache } from "../src/services/imageCacheBudget.ts";

const img = (width, height) => ({ width, height });

test("decoded pixel budget evicts least recently used, not most recently read", () => {
  const cache = new DecodedImageCache(4, 100);
  cache.set("a", img(5, 10));
  cache.set("b", img(5, 5));
  assert.equal(cache.get("a")?.width, 5); // a becomes most recent
  cache.set("c", img(5, 10)); // b (25 pixels) must be evicted
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a")?.height, 10);
  assert.equal(cache.get("c")?.height, 10);
  assert.equal(cache.pixelCount, 100);
});

test("entry count is also bounded even for tiny images", () => {
  const cache = new DecodedImageCache(2, 1000);
  cache.set("a", img(1, 1));
  cache.set("b", img(1, 1));
  cache.set("c", img(1, 1));
  assert.equal(cache.size, 2);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.pixelCount, 2);
});

test("oversized or malformed images are rendered by caller but never retained", () => {
  const cache = new DecodedImageCache(3, 100);
  cache.set("keep", img(5, 5));
  for (const bad of [img(20, 20), img(0, 1), img(Infinity, 1), img(1.5, 2)]) {
    cache.set("bad", bad);
    assert.equal(cache.get("bad"), undefined);
  }
  assert.equal(cache.get("keep")?.width, 5);
  assert.equal(cache.pixelCount, 25);
});

test("replacing and deleting entries maintains exact accounting", () => {
  const cache = new DecodedImageCache(2, 100);
  cache.set("a", img(5, 5));
  cache.set("a", img(10, 5));
  assert.equal(cache.pixelCount, 50);
  cache.set("b", img(5, 5));
  assert.equal(cache.pixelCount, 75);
  cache.delete("a");
  assert.equal(cache.pixelCount, 25);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.pixelCount, 0);
});

test("invalid cache budgets are rejected", () => {
  assert.throws(() => new DecodedImageCache(0, 100), /limits/);
  assert.throws(() => new DecodedImageCache(1, NaN), /limits/);
});
