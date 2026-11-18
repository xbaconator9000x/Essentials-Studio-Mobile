import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guard the actual mobile stylesheet, not only the React DOM: an older
// single-line toolbar rule hid every direct button in Quick Tools, including
// the Pan and More controls, despite all component tests passing.
describe("portrait map toolbar stylesheet", () => {
  const css = readFileSync(new URL("../src/components/MapEditor/MapEditor.css", import.meta.url), "utf8");

  it("overrides the legacy hidden-button rule with visible touch actions", () => {
    const hidden = css.lastIndexOf(".map-editor-toolbar--compact .map-toolbar-quick-tools > button");
    const visible = css.lastIndexOf(".map-editor-toolbar--compact .map-toolbar-quick-tools > button {\n    display: inline-flex;");
    expect(hidden).toBeGreaterThanOrEqual(0);
    expect(visible).toBe(hidden);
  });

  it("uses a vertically scrollable two-column task workspace rather than a single horizontal rail", () => {
    const finalLayout = css.slice(css.lastIndexOf("/* The task-based mobile toolbar supersedes"));
    expect(finalLayout).toContain("grid-template-columns: auto minmax(0, 1fr)");
    expect(finalLayout).toContain("overflow-y: auto");
    expect(finalLayout).toContain("touch-action: pan-y");
    expect(finalLayout).toContain("grid-column: 1 / -1");
    expect(finalLayout).toContain(".map-zoom-slider {\n    display: block;");
  });
});
