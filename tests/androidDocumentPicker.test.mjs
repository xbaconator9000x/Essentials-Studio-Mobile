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
