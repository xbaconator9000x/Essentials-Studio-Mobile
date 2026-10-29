import test from "node:test";
import assert from "node:assert/strict";
import { boundedAsyncMap } from "../src/services/boundedAsyncMap.ts";

test("Android image transfers never exceed the configured concurrency", async () => {
  let active = 0;
  let peak = 0;
  const result = await boundedAsyncMap([0, 1, 2, 3, 4, 5, 6, 7], 2, async (id) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, (8 - id) * 2));
    active--;
    return id * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(result, [0, 10, 20, 30, 40, 50, 60, 70]);
});

test("empty and absent autotile slots preserve their exact positions", async () => {
  const names = ["tileset", "water", "", "grass", "", "rock"];
  const loaded = await boundedAsyncMap(names, 2, async (name) => name || null);
  assert.deepEqual(loaded, ["tileset", "water", null, "grass", null, "rock"]);
  assert.deepEqual(await boundedAsyncMap([], 2, async () => "unused"), []);
});

test("invalid concurrency rejects before launching transfers", async () => {
  let calls = 0;
  for (const concurrency of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(boundedAsyncMap([1], concurrency, async () => {
      calls++;
      return 1;
    }), /positive safe integer/);
  }
  assert.equal(calls, 0);
});

test("image transfer errors propagate instead of producing a success placeholder", async () => {
  await assert.rejects(boundedAsyncMap(["tileset", "bad"], 2, async (name) => {
    if (name === "bad") throw new Error("Android graphics transfer failed");
    return name;
  }), /graphics transfer failed/);
});
