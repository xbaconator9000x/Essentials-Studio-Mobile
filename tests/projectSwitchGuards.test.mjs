import test from "node:test";
import assert from "node:assert/strict";
import { confirmProjectSwitch } from "../src/services/projectSwitchGuards.ts";

test("clean project switches without prompting or saving", async () => {
  let dirty = false;
  let prompts = 0;
  let saves = 0;
  assert.equal(await confirmProjectSwitch({
    hasActiveProject: true,
    hasUnsavedEdits: () => dirty,
    confirm: async () => { prompts++; return true; },
    saveAll: async () => { saves++; },
  }), true);
  assert.equal(prompts, 0);
  assert.equal(saves, 0);
});

test("cancelling a dirty project switch preserves the active work", async () => {
  let saves = 0;
  assert.equal(await confirmProjectSwitch({
    hasActiveProject: true,
    hasUnsavedEdits: () => true,
    confirm: async () => false,
    saveAll: async () => { saves++; },
  }), false);
  assert.equal(saves, 0);
});

test("a dirty project switch waits for Save All and the clean-state update", async () => {
  let dirty = true;
  const order = [];
  assert.equal(await confirmProjectSwitch({
    hasActiveProject: true,
    hasUnsavedEdits: () => dirty,
    confirm: async (message) => {
      order.push("confirm");
      assert.match(message, /Cancel keeps the current project open/);
      return true;
    },
    saveAll: async () => {
      order.push("save");
      dirty = false;
    },
  }), true);
  assert.deepEqual(order, ["confirm", "save"]);
});

test("save failures and edits still dirty after Save All abort the switch", async () => {
  await assert.rejects(confirmProjectSwitch({
    hasActiveProject: true,
    hasUnsavedEdits: () => true,
    confirm: async () => true,
    saveAll: async () => { throw new Error("save failed"); },
  }), /save failed/);

  await assert.rejects(confirmProjectSwitch({
    hasActiveProject: true,
    hasUnsavedEdits: () => true,
    confirm: async () => true,
    saveAll: async () => {},
  }), /unsaved edits remain/);
});

test("an absent active project does not prompt even if stale editor state is dirty", async () => {
  let prompts = 0;
  assert.equal(await confirmProjectSwitch({
    hasActiveProject: false,
    hasUnsavedEdits: () => true,
    confirm: async () => { prompts++; return false; },
    saveAll: async () => { throw new Error("must not save"); },
  }), true);
  assert.equal(prompts, 0);
});
