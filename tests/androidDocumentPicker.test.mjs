import assert from "node:assert/strict";
import test from "node:test";
import { isAndroidDocumentPickerCancellation, pickAndroidDocument } from "../src/services/androidDocumentPicker.ts";
import { importAndOpenProject } from "../src/services/importOpenGuards.ts";

test("Tauri Android picker cancellation rejection is treated as no selection", async () => {
  let imports = 0;
  const documentUri = await pickAndroidDocument(() => Promise.reject("File picker cancelled"));
  await importAndOpenProject(documentUri, {
    importArchive: async () => { imports++; return "/private/project"; },
    openProject: async () => {},
    discardFailedImport: async () => {},
    isActiveProject: () => false,
  });
  assert.equal(imports, 0);
  assert.equal(isAndroidDocumentPickerCancellation("File picker cancelled"), true);
});

test("picker cancellation matching does not swallow provider or permission failures", async () => {
  const failure = new Error("Permission denied by document provider");
  assert.equal(isAndroidDocumentPickerCancellation(failure), false);
  await assert.rejects(pickAndroidDocument(() => Promise.reject(failure)), failure);
});

test("selected Android document URI is passed through unchanged", async () => {
  const uri = "content://com.android.providers.downloads.documents/document/42";
  assert.equal(await pickAndroidDocument(async () => uri), uri);
});

test("native Android import picker times out instead of hanging indefinitely", async () => {
  await assert.rejects(
    pickAndroidDocument(() => new Promise(() => {}), 5),
    /picker did not return a document.*Import did not start/,
  );
});

test("late Android picker selection cannot turn a timed-out import into a selection", async () => {
  let resolvePicker;
  const pending = new Promise((resolve) => { resolvePicker = resolve; });
  const attempt = pickAndroidDocument(() => pending, 5);
  await assert.rejects(attempt, /picker did not return a document/);
  resolvePicker("content://provider/document/late");
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("Android picker rejects invalid timeouts and still propagates provider errors", async () => {
  await assert.rejects(pickAndroidDocument(async () => null, 0), /Invalid Android document picker timeout/);
  await assert.rejects(
    pickAndroidDocument(async () => { throw new Error("Provider permission denied"); }, 100),
    /Provider permission denied/,
  );
});
