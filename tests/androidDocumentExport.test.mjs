import test from "node:test";
import assert from "node:assert/strict";
import { exportAndroidDocument } from "../src/services/androidDocumentExport.ts";

test("cancelled Android picker never writes or reports completed export", async () => {
  const calls = [];
  const result = await exportAndroidDocument("export-1", 100, "Project.zip", {
    pickDestination: async (name) => { calls.push(name); return null; },
    writeAndVerify: async () => { throw new Error("must not write"); },
  }, (percent) => calls.push(percent));
  assert.equal(result, "cancelled");
  assert.deepEqual(calls, ["Project.zip"]);
});

test("unscoped Android picker paths are rejected before native write", async () => {
  let writes = 0;
  await assert.rejects(exportAndroidDocument("export-1", 100, "Project.zip", {
    pickDestination: async () => "/storage/emulated/0/Project.zip",
    writeAndVerify: async () => { writes++; return 100; },
  }), /content URI/);
  assert.equal(writes, 0);
});

test("readback mismatch never reports successful completion", async () => {
  const progress = [];
  await assert.rejects(exportAndroidDocument("export-1", 100, "Project.zip", {
    pickDestination: async () => "content://com.android.providers.downloads.documents/document/42",
    writeAndVerify: async () => 99,
  }, (value) => progress.push(value)), /readback size mismatch/);
  assert.deepEqual(progress, [95]);
});

test("successful native readback reports completion only after verified bytes", async () => {
  const progress = [];
  const result = await exportAndroidDocument("export-1", 100, "Project.zip", {
    pickDestination: async () => "content://com.android.providers.downloads.documents/document/42",
    writeAndVerify: async (id, uri) => {
      assert.equal(id, "export-1");
      assert.ok(uri.startsWith("content://"));
      assert.deepEqual(progress, [95]);
      return 100;
    },
  }, (value) => progress.push(value));
  assert.equal(result, "saved");
  assert.deepEqual(progress, [95, 100]);
});

test("provider errors propagate without false success", async () => {
  const progress = [];
  await assert.rejects(exportAndroidDocument("export-1", 100, "Project.zip", {
    pickDestination: async () => "content://provider/document/42",
    writeAndVerify: async () => { throw new Error("provider refused write"); },
  }, (value) => progress.push(value)), /provider refused write/);
  assert.deepEqual(progress, [95]);
});
