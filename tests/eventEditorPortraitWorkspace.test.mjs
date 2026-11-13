import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/components/EventEditor/EventEditor.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/components/EventEditor/EventEditor.css", import.meta.url), "utf8");

test("portrait event navigation retains both mounted editor panels", () => {
  assert.match(source, /useState<"commands" \| "properties">\("commands"\)/);
  assert.match(source, /event-editor-body--\$\{mobilePanel\}/);
  assert.match(source, /aria-pressed=\{mobilePanel === "commands"\}/);
  assert.match(source, /aria-pressed=\{mobilePanel === "properties"\}/);
  assert.match(source, /setMobilePanel\("properties"\); setPropertiesCollapsed\(false\)/);
  assert.match(source, /<PageProperties page=\{page\} onUpdatePage=\{updatePage\}/);
  assert.match(source, /className="event-command-panel"/);
});

test("portrait event panels hide inactive content without affecting desktop layout", () => {
  assert.match(styles, /\.event-editor-mobile-tabs \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /\.event-editor-body--commands > \.event-page-properties \{ display: none; \}/);
  assert.match(styles, /\.event-editor-body--properties > \.event-command-panel \{ display: none; \}/);
  assert.match(styles, /\.event-editor-body--properties > \.event-page-properties/);
});
