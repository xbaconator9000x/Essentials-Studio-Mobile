import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/components/MobileWorkspaceBar.css", import.meta.url), "utf8");

test("portrait phone workspace retains two-column, full-height command targets", () => {
  const portrait = css.match(/@media \(max-width: 600px\) and \(orientation: portrait\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(portrait, "portrait phone layout must be explicit");
  assert.match(portrait, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(portrait, /min-height:\s*44px/);
  assert.match(portrait, /Save all changes/);
  assert.match(portrait, /Export project ZIP/);
});

test("workspace strip accounts for left and right display cutouts", () => {
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /env\(safe-area-inset-right\)/);
  assert.match(css, /@media \(max-width: 900px\) and \(orientation: landscape\)/);
});

test("disclosed context commands cannot consume canvas height while hidden", () => {
  assert.match(css, /app-mobile-workspace-secondary/);
  assert.match(css, /app-mobile-workspace-tools-toggle/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(160px, 240px\)/);
  assert.match(css, /min-height:\s*44px/);
});
