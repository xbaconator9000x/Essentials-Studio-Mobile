import type { SpriteTool } from "./spriteEditorPixels";

export type SpriteShortcut =
  | { type: "tool"; tool: SpriteTool }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "copy" }
  | { type: "cut" }
  | { type: "paste" };

interface ShortcutEvent {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  return element.isContentEditable === true
    || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName?.toUpperCase() ?? "")
    || element.getAttribute?.("contenteditable") === "true";
}

export function resolveSpriteShortcut(event: ShortcutEvent): SpriteShortcut | null {
  if (event.altKey || isEditableTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === "z") return { type: event.shiftKey ? "redo" : "undo" };
    if (key === "y") return { type: "redo" };
    if (key === "c") return { type: "copy" };
    if (key === "x") return { type: "cut" };
    if (key === "v") return { type: "paste" };
    return null;
  }
  if (event.shiftKey) return null;
  const tools: Record<string, SpriteTool> = {
    b: "brush",
    e: "eraser",
    i: "eyedropper",
    g: "fill",
    s: "select",
    p: "pan",
  };
  const tool = tools[key];
  return tool ? { type: "tool", tool } : null;
}
