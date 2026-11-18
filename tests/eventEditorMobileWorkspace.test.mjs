import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

// Guards against introducing workspace state/CSS without actually rendering
// the controls, which previously broke the frontend's noUnusedLocals build.
const editor = readFileSync(new URL("../src/components/EventEditor/EventEditor.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/EventEditor/EventEditor.css", import.meta.url), "utf8");

test("mobile event workspace exposes both navigation buttons", () => {
  assert.match(editor, /className="event-editor-mobile-tabs"/);
  assert.match(editor, /aria-label="Event editing workspace"/);
  assert.match(editor, /onClick=\{\(\) => setMobilePanel\("commands"\)\}/);
  assert.match(editor, /setMobilePanel\("properties"\)/);
});

test("event workspace switches visible panels without conditional unmounting", () => {
  assert.match(editor, /event-editor-body--\$\{mobilePanel\}/);
  assert.match(css, /event-editor-body--commands > \.event-page-properties\s*\{\s*display: none/);
  assert.match(css, /event-editor-body--properties > \.event-command-panel\s*\{\s*display: none/);
  assert.match(editor, /setPropertiesCollapsed\(false\)/);
  assert.match(editor, /<PageProperties page=\{page\}/);
  assert.match(editor, /className="event-command-panel"/);
});
