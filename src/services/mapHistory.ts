import type { MapRenderData } from "../types/index.ts";
import { applyAction, revertAction, type UndoStack } from "./mapEditor.ts";

/**
 * Undo/redo are real map mutations, even when they restore an earlier tile.
 * Notify the global save coordinator on every successful history step so
 * Save All / ZIP export never omit a keyboard-originated tile change.
 */
export function replayMapHistory(
  map: MapRenderData,
  history: UndoStack,
  direction: "undo" | "redo",
  markDirty: () => void,
): boolean {
  const action = direction === "undo" ? history.undo() : history.redo();
  if (!action) return false;
  if (direction === "undo") revertAction(map, action);
  else applyAction(map, action);
  markDirty();
  return true;
}
