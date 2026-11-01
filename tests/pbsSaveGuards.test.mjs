import test from "node:test";
import assert from "node:assert/strict";
import { savePbsSnapshot, snapshotPbsSections } from "../src/services/pbsSaveGuards.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("PBS save keeps dirty until the native write actually resolves", async () => {
  const pending = deferred();
  let clean = false;
  let baseline = null;
  const payload = snapshotPbsSections([{ header: "PIKACHU", fields: [{ key: "Name", value: "Pikachu" }] }]);
  const save = savePbsSnapshot(payload, () => pending.promise, () => { baseline = payload; },
    () => { clean = true; }, () => true);
  assert.equal(clean, false);
  pending.resolve();
  await save;
  assert.equal(clean, true);
  assert.deepEqual(baseline, payload);
});

test("PBS write failure propagates and leaves dirty/baseline untouched", async () => {
  let clean = false;
  let baseline = "previous";
  await assert.rejects(
    savePbsSnapshot([], async () => { throw new Error("ENOSPC"); },
      () => { baseline = "new"; }, () => { clean = true; }, () => true),
    /ENOSPC/,
  );
  assert.equal(clean, false);
  assert.equal(baseline, "previous");
});

test("edits during pending PBS save remain dirty and baseline becomes written snapshot", async () => {
  const pending = deferred();
  let revision = 4;
  const savedRevision = revision;
  let clean = false;
  let baseline = null;
  const source = [{ header: "TEST", fields: [{ key: "Name", value: "Old" }] }];
  const snapshot = snapshotPbsSections(source);
  const save = savePbsSnapshot(snapshot, () => pending.promise,
    () => { baseline = snapshot; }, () => { clean = true; },
    () => revision === savedRevision);
  source[0].fields[0].value = "New";
  revision += 1;
  assert.equal(snapshot[0].fields[0].value, "Old", "native writer must get immutable snapshot");
  pending.resolve();
  await assert.rejects(save, /PBS changed while saving/);
  assert.equal(clean, false);
  assert.equal(baseline[0].fields[0].value, "Old", "Cancel baseline must match disk");
});

test("switching PBS project/file while saving cannot clean the new document", async () => {
  const pending = deferred();
  let identity = "project-a/pokemon.txt";
  let clean = false;
  const save = savePbsSnapshot([], () => pending.promise, () => {},
    () => { clean = true; }, () => identity === "project-a/pokemon.txt");
  identity = "project-b/pokemon.txt";
  pending.resolve();
  await assert.rejects(save, /PBS changed while saving/);
  assert.equal(clean, false);
});

test("snapshot copies each PBS field and section without modifying source", () => {
  const source = [{ header: "TEST", fields: [{ key: "Name", value: "A" }] }];
  const snapshot = snapshotPbsSections(source);
  assert.notEqual(snapshot, source);
  assert.notEqual(snapshot[0], source[0]);
  assert.notEqual(snapshot[0].fields, source[0].fields);
  assert.notEqual(snapshot[0].fields[0], source[0].fields[0]);
  snapshot[0].fields[0].value = "B";
  assert.equal(source[0].fields[0].value, "A");
});
