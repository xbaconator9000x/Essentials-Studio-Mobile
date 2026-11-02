/**
 * Map navigation must account for every dirty editor, not only painted tiles.
 * An open event dialog edits MapNNN.rxdata too; closing it by navigating away
 * previously discarded its pending commands without saving or prompting.
 */
export async function saveBeforeMapNavigation(
  hasUnsavedEdits: () => boolean,
  confirmSave: () => Promise<boolean>,
  saveAll: () => Promise<void>,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (!isCurrent()) return false;
  if (!hasUnsavedEdits()) return true;
  if (!(await confirmSave()) || !isCurrent()) return false;
  await saveAll();
  // React registrations update after commit; do not treat a queued state
  // update as a completed disk write or silently unmount a dirty editor.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (!isCurrent()) return false;
  if (hasUnsavedEdits()) {
    throw new Error("Unsaved edits remain after Save All. Map navigation cancelled.");
  }
  return true;
}
