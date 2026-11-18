import test from "node:test";
import assert from "node:assert/strict";
import {
  getUnsupportedArchiveMessage,
  UNSUPPORTED_RAR_MESSAGE,
} from "../src/services/archiveFormat.ts";

test("RAR extensions receive local extraction guidance regardless of case", () => {
  assert.equal(getUnsupportedArchiveMessage("Essentials.RAR"), UNSUPPORTED_RAR_MESSAGE);
});

test("RAR4 and RAR5 signatures are rejected even when mislabeled as ZIP", () => {
  for (const header of [
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00],
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00],
  ]) {
    assert.equal(getUnsupportedArchiveMessage("project.zip", header), UNSUPPORTED_RAR_MESSAGE);
  }
});

test("ordinary ZIP signatures and unrelated files are not identified as RAR", () => {
  assert.equal(getUnsupportedArchiveMessage("project.zip", [0x50, 0x4b, 0x03, 0x04]), null);
  assert.equal(getUnsupportedArchiveMessage("project.7z", [0x37, 0x7a, 0xbc, 0xaf]), null);
});
