import test from "node:test";
import assert from "node:assert/strict";
import { saveEventSnapshot } from "../src/services/eventSaveGuards.ts";

const event = () => ({ id: 1, pages: [{ list: [{ code: 101, indent: 0, parameters: ["Old dialogue"] }] }] });

test("successful event save acknowledges only its submitted revision", async () => {
  let revision = 3;
  let written;
  const result = await saveEventSnapshot(event(), revision, () => revision, async value => { written = value; });
  assert.equal(result, true);
  assert.equal(written.pages[0].list[0].parameters[0], "Old dialogue");
});

test("edits during native write stay dirty; submitted snapshot cannot change", async () => {
  const source = event();
  let revision = 4;
  let release;
  let captured;
  const blocked = new Promise(resolve => { release = resolve; });
  const pending = saveEventSnapshot(source, revision, () => revision, async snapshot => {
    captured = snapshot;
    await blocked;
  });
  source.pages[0].list[0].parameters[0] = "New dialogue";
  revision++;
  release();
  assert.equal(await pending, false);
  assert.equal(captured.pages[0].list[0].parameters[0], "Old dialogue");
});

test("native event write failures propagate", async () => {
  await assert.rejects(saveEventSnapshot(event(), 1, () => 1, async () => {
    throw new Error("write failed");
  }), /write failed/);
});

test("nested event command parameters are detached from mutable UI state", async () => {
  const source = event();
  let written;
  await saveEventSnapshot(source, 0, () => 0, async snapshot => { written = snapshot; });
  written.pages[0].list[0].parameters.push({ path: ["A"] });
  assert.equal(source.pages[0].list[0].parameters.length, 1);
});
