import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SPRITE_TRACE_TRANSFORM,
  readSpriteTraceTransform,
  spriteTracePreferenceKey,
  writeSpriteTraceTransform,
} from "../src/services/spriteEditorPreferences.ts";

function makeStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("trace transform preferences persist independently per project and sprite", () => {
  const storage = makeStorage();
  const guide = { opacity: 60, scale: 125, offsetX: -20, offsetY: 35 };
  writeSpriteTraceTransform("/project/a", "Guide", guide, storage);

  assert.deepEqual(readSpriteTraceTransform("/project/a", "Guide", storage), guide);
  assert.deepEqual(readSpriteTraceTransform("/project/a", "Hero", storage), DEFAULT_SPRITE_TRACE_TRANSFORM);
  assert.deepEqual(readSpriteTraceTransform("/project/b", "Guide", storage), DEFAULT_SPRITE_TRACE_TRANSFORM);
  assert.match(spriteTracePreferenceKey("/project/a", "Guide"), /%2Fproject%2Fa:Guide$/);
});

test("trace preferences clamp out-of-range data and ignore malformed storage", () => {
  const storage = makeStorage();
  const key = spriteTracePreferenceKey("/project", "Guide");
  storage.setItem(key, JSON.stringify({
    opacity: 120,
    scale: 5,
    offsetX: -250,
    offsetY: 250,
  }));
  assert.deepEqual(readSpriteTraceTransform("/project", "Guide", storage), {
    opacity: 100,
    scale: 25,
    offsetX: -100,
    offsetY: 100,
  });

  storage.setItem(key, "{");
  assert.deepEqual(readSpriteTraceTransform("/project", "Guide", storage), DEFAULT_SPRITE_TRACE_TRANSFORM);
});

test("invalid identity and unavailable storage fail safely", () => {
  assert.equal(spriteTracePreferenceKey("", "Guide"), null);
  assert.deepEqual(readSpriteTraceTransform("", "Guide", makeStorage()), DEFAULT_SPRITE_TRACE_TRANSFORM);
  const unavailable = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("full"); },
  };
  assert.deepEqual(readSpriteTraceTransform("/project", "Guide", unavailable), DEFAULT_SPRITE_TRACE_TRANSFORM);
  assert.doesNotThrow(() => writeSpriteTraceTransform("/project", "Guide", DEFAULT_SPRITE_TRACE_TRANSFORM, unavailable));
});
