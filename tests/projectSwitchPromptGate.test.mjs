import test from "node:test";
import assert from "node:assert/strict";
import { ProjectSwitchPromptGate } from "../src/services/projectSwitchPromptGate.ts";

test("overlapping project switches cannot show two confirmations or duplicate Save All", async () => {
  const gate = new ProjectSwitchPromptGate();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let prompts = 0;
  const first = gate.confirm(async () => { prompts++; await pending; return true; });
  const second = await gate.confirm(async () => { prompts++; return true; });
  assert.equal(second, false);
  assert.equal(prompts, 1);
  release();
  assert.equal(await first, true);
  assert.equal(await gate.confirm(async () => { prompts++; return true; }), true);
  assert.equal(prompts, 2);
});

test("cancelled or failed confirmations release the gate for the next project", async () => {
  const gate = new ProjectSwitchPromptGate();
  assert.equal(await gate.confirm(async () => false), false);
  await assert.rejects(gate.confirm(async () => { throw new Error("Save All failed"); }), /Save All failed/);
  assert.equal(await gate.confirm(async () => true), true);
});
