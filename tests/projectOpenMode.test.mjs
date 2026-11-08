import test from "node:test";
import assert from "node:assert/strict";
import { supportsDirectProjectFolderOpen } from "../src/services/projectOpenMode.ts";

test("direct project folder opening is unavailable on Android SAF", () => {
  assert.equal(supportsDirectProjectFolderOpen("Mozilla/5.0 (Linux; Android 14)"), false);
  assert.equal(supportsDirectProjectFolderOpen("Android"), false);
});

test("desktop project folder opening remains available", () => {
  assert.equal(supportsDirectProjectFolderOpen("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), true);
  assert.equal(supportsDirectProjectFolderOpen("Mozilla/5.0 (X11; Linux x86_64)"), true);
});
