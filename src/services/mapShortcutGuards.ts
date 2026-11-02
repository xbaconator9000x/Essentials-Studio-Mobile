/**
 * Map shortcuts are global only while the map is the active editor.
 * Ctrl/Cmd+Z/C/V in a dialogue, PBS field, script editor or text input
 * must retain the platform's native text-editing behavior.
 */
export function shouldHandleMapShortcut(
  target: EventTarget | null,
  modalOpen: boolean,
): boolean {
  if (modalOpen) return false;
  if (!target || typeof target !== "object") return true;
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  if (element.isContentEditable) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName?.toUpperCase() ?? "")) {
    return false;
  }
  if (typeof element.closest === "function" &&
    element.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"]')) {
    return false;
  }
  return true;
}
