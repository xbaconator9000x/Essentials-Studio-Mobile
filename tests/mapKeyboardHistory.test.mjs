import assert from "node:assert/strict";
import test from "node:test";
import { UndoStack } from "../src/services/mapEditor.ts";
import { replayMapHistory } from "../src/services/mapHistory.ts";
import { shouldHandleMapShortcut } from "../src/services/mapShortcutGuards.ts";

test("undo and redo both mark map dirty so ZIP export saves their tile changes", () => {
  const map = { id: 1, width: 2, height: 1, tiles: [400, 0, 0, 0, 0, 0], events: [] };
  const history = new UndoStack();
  history.push({ type: "paint", changes: [
    { x: 0, y: 0, layer: 0, oldTileId: 0, newTileId: 400 },
  ], timestamp: 1 });
  let revisions = 0;
  assert.equal(replayMapHistory(map, history, "undo", () => revisions++), true);
  assert.equal(map.tiles[0], 0);
  assert.equal(revisions, 1);
  assert.equal(replayMapHistory(map, history, "redo", () => revisions++), true);
  assert.equal(map.tiles[0], 400);
  assert.equal(revisions, 2);
  assert.equal(replayMapHistory(map, history, "redo", () => revisions++), false);
  assert.equal(revisions, 2);
});

test("map undo/redo only changes the targeted XP layer", () => {
  const map = { id: 1, width: 1, height: 1, tiles: [0, 0, 900], events: [] };
  const history = new UndoStack();
  history.push({ type: "paint", changes: [
    { x: 0, y: 0, layer: 2, oldTileId: 0, newTileId: 900 },
  ], timestamp: 1 });
  assert.equal(replayMapHistory(map, history, "undo", () => {}), true);
  assert.deepEqual(map.tiles, [0, 0, 0]);
});

test("text fields, contenteditable and nested dialog controls retain their own shortcuts", () => {
  for (const tagName of ["INPUT", "textarea", "Select"]) {
    assert.equal(shouldHandleMapShortcut({ tagName }, false), false);
  }
  assert.equal(shouldHandleMapShortcut({ isContentEditable: true }, false), false);
  assert.equal(shouldHandleMapShortcut({
    tagName: "BUTTON", closest: () => ({ tagName: "DIV" }),
  }, false), false);
});

test("map shortcuts work on canvas only when no modal editor is open", () => {
  const canvas = { tagName: "CANVAS", closest: () => null };
  assert.equal(shouldHandleMapShortcut(canvas, false), true);
  assert.equal(shouldHandleMapShortcut(canvas, true), false);
  assert.equal(shouldHandleMapShortcut(null, false), true);
});
