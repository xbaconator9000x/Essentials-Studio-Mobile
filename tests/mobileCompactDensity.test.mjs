import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const compact = readFileSync(new URL("../src/mobileCompact.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("compact phone UI stylesheet loads after the existing responsive app styles", () => {
  assert.match(app, /import "\.\/App\.css";\s*import "\.\/mobileCompact\.css";/);
  assert.match(compact, /^\/\*[\s\S]+?\*\/@media \(max-width: 900px\) \{/);
  assert.doesNotMatch(compact, /transform:\s*scale\(/, "Never shrink or distort map/sprite pixels");
});

test("map toolbar, nav and Save/Export use genuinely shorter rows, not just smaller text", () => {
  assert.match(compact, /--mobile-compact-control:\s*30px/);
  assert.match(compact, /\.app-mobile-workspace-bar\s*\{\s*display:\s*grid/);
  assert.match(compact, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(compact, /\.app-mobile-workspace-actions\s*\{\s*grid-template-columns:\s*64px 80px/);
  assert.match(compact, /\.app-mobile-workspace-secondary\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.match(compact, /\.app-mobile-nav\s*\{\s*min-height:\s*38px/);
  assert.match(compact, /\.map-editor-toolbar\.map-editor-toolbar--compact\s*\{\s*max-height:\s*44px/);
  assert.match(compact, /\.sprite-editor-quick-tools button,[\s\S]*?min-height:\s*30px/);
});

test("narrow phones, cutouts, scrolling map tools and paint palette stay functional", () => {
  assert.match(compact, /@media \(max-width: 355px\)/);
  assert.match(compact, /env\(safe-area-inset-right\)/);
  assert.match(compact, /env\(safe-area-inset-left\)/);
  assert.match(compact, /\.palette-use-tile\s*\{\s*min-height:\s*34px/);
  assert.match(compact, /\.sprite-editor-quick-swatches > button\s*\{/);
  assert.match(compact, /@media \(max-width: 900px\) and \(orientation: landscape\)/);
});
