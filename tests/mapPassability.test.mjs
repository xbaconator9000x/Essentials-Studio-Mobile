import test from "node:test";
import assert from "node:assert/strict";
import { effectiveBlockedPassageMask } from "../src/services/mapPassability.ts";

test("combines collision bits across blocking layers while ignoring empty and star tiles", () => {
  assert.equal(effectiveBlockedPassageMask([
    { tileId: 7, passage: 0b0101, priority: 0 },
    { tileId: 0, passage: 0, priority: 0 },
    { tileId: 9, passage: 0b0011, priority: 2 },
    { tileId: 4, passage: 0b0110, priority: 0 },
  ]), 0b0100);
});

test("a lower tile can permit directions blocked by a tile above it", () => {
  assert.equal(effectiveBlockedPassageMask([
    { tileId: 3, passage: 0b0001, priority: 0 },
    { tileId: 2, passage: 0b0010, priority: 0 },
  ]), 0);
});

test("returns fully blocked when there is no non-star tile to provide passage data", () => {
  assert.equal(effectiveBlockedPassageMask([
    { tileId: 0, passage: 0, priority: 0 },
    { tileId: 2, passage: 0, priority: 1 },
  ]), 0x0f);
});
