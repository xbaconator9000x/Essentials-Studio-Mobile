import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// This source integration guard complements the functional saveBeforeMapNavigation
// tests. It prevents a regression where the portrait map tree changes screens
// before the async save prompt and map/graphics loading have succeeded.
const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("portrait map tree requests navigation without switching screens prematurely", () => {
  assert.match(source, /onSelectMap=\{\(id\) => \{\s*void handleSelectMap\(id, false, mobileLayout\);\s*\}\}/);
  assert.doesNotMatch(source, /onSelectMap=\{\(id\) => \{\s*if \(mobileLayout\) setMobileSection\("maps"\)/);
});

test("map screen transition occurs only in the successful guarded map commit", () => {
  const handler = source.slice(source.indexOf("const handleSelectMap = useCallback("), source.indexOf("const handleMapDirty = useCallback("));
  const loaded = handler.indexOf("const prepared = await prepareMapSelection(");
  const commit = handler.indexOf("setCurrentMapId(mapId);");
  const switchScreen = handler.indexOf('if (openMobileEditor && isCurrent()) setMobileSection("maps");');
  assert.ok(loaded >= 0 && commit > loaded && switchScreen > commit);
  assert.match(handler.slice(0, loaded), /if \(!proceed\) return;/);
  assert.match(handler.slice(loaded, commit), /if \(!isCurrent\(\)\) return;/);
  assert.match(handler.slice(loaded, commit), /Unsaved edits appeared while loading/);
});
