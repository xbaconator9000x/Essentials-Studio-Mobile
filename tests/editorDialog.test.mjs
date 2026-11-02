import test from "node:test";
import assert from "node:assert/strict";
import { confirmEditor } from "../src/services/editorDialog.ts";

test("browser confirmation respects explicit consent and cancellation", async () => {
  const messages = [];
  const runtime = {
    isNative: () => false,
    browserConfirm: message => { messages.push(message); return false; },
    nativeConfirm: async () => { throw Error("native plugin must not be invoked"); },
  };
  assert.equal(await confirmEditor("Discard changes?", runtime), false);
  assert.deepEqual(messages, ["Discard changes?"]);
  assert.equal(await confirmEditor("Save first?", {
    isNative: () => false, browserConfirm: () => true,
  }), true);
});

test("native confirmation keeps Tauri plugin path and does not call browser", async () => {
  let called = 0;
  assert.equal(await confirmEditor("Delete event?", {
    isNative: () => true,
    nativeConfirm: async message => { called++; assert.equal(message, "Delete event?"); return false; },
    browserConfirm: () => { throw Error("browser must not run"); },
  }), false);
  assert.equal(called, 1);
});

test("native dialog failures propagate instead of discarding edits", async () => {
  await assert.rejects(confirmEditor("Discard?", {
    isNative: () => true,
    nativeConfirm: async () => { throw Error("native IPC unavailable"); },
    browserConfirm: () => true,
  }), /native IPC unavailable/);
});

test("missing confirmation UI fails closed", async () => {
  await assert.rejects(confirmEditor("Delete?", { isNative: () => false }),
    /Confirmation is unavailable/);
});
