import { after, test } from "node:test";
import assert from "node:assert/strict";

const { readBooleanPanelPreference, writeBooleanPanelPreference } = await import(
  "../src/services/panelPreferences.ts"
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
});

function installStorage(storage) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
}

test("panel preference reads only explicit boolean values", () => {
  const values = new Map([
    ["expanded", "false"],
    ["collapsed", "true"],
    ["invalid", "yes"],
  ]);
  installStorage({ getItem: (key) => values.get(key) ?? null });

  assert.equal(readBooleanPanelPreference("expanded"), false);
  assert.equal(readBooleanPanelPreference("collapsed"), true);
  assert.equal(readBooleanPanelPreference("missing"), null);
  assert.equal(readBooleanPanelPreference("invalid"), null);
});

test("panel preference writes booleans and tolerates unavailable storage", () => {
  const values = new Map();
  installStorage({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });

  writeBooleanPanelPreference("visible", false);
  assert.equal(values.get("visible"), "false");
  assert.equal(readBooleanPanelPreference("visible"), false);

  installStorage({
    getItem() { throw new Error("storage blocked"); },
    setItem() { throw new Error("storage blocked"); },
  });
  assert.equal(readBooleanPanelPreference("visible"), null);
  assert.doesNotThrow(() => writeBooleanPanelPreference("visible", true));
});
