import test from "node:test";
import assert from "node:assert/strict";
import { resolveSpriteShortcut } from "../src/services/spriteEditorShortcuts.ts";

test("sprite tool and history shortcuts resolve without intercepting text fields", () => {
  assert.deepEqual(resolveSpriteShortcut({ key: "b" }), { type: "tool", tool: "brush" });
  assert.deepEqual(resolveSpriteShortcut({ key: "g" }), { type: "tool", tool: "fill" });
  assert.deepEqual(resolveSpriteShortcut({ key: "s" }), { type: "tool", tool: "select" });
  assert.deepEqual(resolveSpriteShortcut({ key: "z", ctrlKey: true }), { type: "undo" });
  assert.deepEqual(resolveSpriteShortcut({ key: "z", metaKey: true, shiftKey: true }), { type: "redo" });
  assert.deepEqual(resolveSpriteShortcut({ key: "y", ctrlKey: true }), { type: "redo" });
  assert.deepEqual(resolveSpriteShortcut({ key: "c", ctrlKey: true }), { type: "copy" });
  assert.deepEqual(resolveSpriteShortcut({ key: "x", metaKey: true }), { type: "cut" });
  assert.deepEqual(resolveSpriteShortcut({ key: "v", ctrlKey: true }), { type: "paste" });
  assert.equal(resolveSpriteShortcut({ key: "e", target: { tagName: "INPUT" } }), null);
  assert.equal(resolveSpriteShortcut({ key: "z", ctrlKey: true, target: { isContentEditable: true } }), null);
  assert.equal(resolveSpriteShortcut({ key: "i", altKey: true }), null);
});
