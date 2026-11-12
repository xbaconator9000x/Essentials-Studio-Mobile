import assert from "node:assert/strict";
import test from "node:test";
import { loadMapEventGraphics } from "../src/services/mapEventGraphics.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("deduplicates event character names without losing sprite order", async () => {
  const seen = [];
  const result = await loadMapEventGraphics(
    ["Guide", "", "Hero", "Guide", "  ", "Villager"],
    async (name) => { seen.push(name); return `sprite:${name}`; },
  );
  assert.deepEqual(seen, ["Guide", "Hero", "Villager"]);
  assert.deepEqual([...result.entries()], [
    ["Guide", "sprite:Guide"],
    ["Hero", "sprite:Hero"],
    ["Villager", "sprite:Villager"],
  ]);
});

test("one bad event sheet cannot hide the other character graphics", async () => {
  const result = await loadMapEventGraphics(["Guide", "Broken", "Hero"], async (name) => {
    if (name === "Broken") throw new Error("missing or corrupted RGSS graphic");
    return name;
  });
  assert.deepEqual([...result.entries()], [
    ["Guide", "Guide"], ["Broken", null], ["Hero", "Hero"],
  ]);
});

test("large NPC maps load only two decoded character images concurrently", async () => {
  let active = 0;
  let peak = 0;
  const release = [];
  const names = Array.from({ length: 9 }, (_, index) => `NPC${index}`);
  const pending = loadMapEventGraphics(names, async (name) => {
    active += 1;
    peak = Math.max(peak, active);
    return new Promise((resolve) => release.push(() => {
      active -= 1;
      resolve(name);
    }));
  });
  await tick();
  assert.equal(active, 2);
  for (let i = 0; i < names.length; i++) {
    assert.ok(release.length > 0);
    release.shift()();
    await tick();
  }
  const result = await pending;
  assert.equal(active, 0);
  assert.equal(peak, 2);
  assert.deepEqual([...result.keys()], names);
});

test("switching maps prevents starting any more obsolete image transfers", async () => {
  let current = true;
  const calls = [];
  const release = [];
  const pending = loadMapEventGraphics(["OldA", "OldB", "OldC", "OldD"], async (name) => {
    calls.push(name);
    return new Promise((resolve) => release.push(() => resolve(name)));
  }, () => current);
  await tick();
  assert.deepEqual(calls, ["OldA", "OldB"]);
  current = false;
  for (const complete of release) complete();
  const result = await pending;
  assert.deepEqual(calls, ["OldA", "OldB"]);
  assert.equal(result.get("OldC"), null);
  assert.equal(result.get("OldD"), null);
});
